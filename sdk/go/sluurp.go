// Package sluurp makes a Go program a Sluurp plugin: functions server code calls.
//
//	func main() {
//		sluurp.Serve(sluurp.Functions{
//			"hello": func(c *sluurp.Call) (any, error) { return "hello " + c.String(0), nil },
//		})
//	}
//
// Calls arrive on stdin and answers leave on stdout, as CBOR frames (a 4-byte big-endian length, then the
// message). Each call runs in a goroutine of its own, so slow ones never hold up the rest. Write logs to
// stderr: the server shows them as the plugin's.
package sluurp

import (
	"bufio"
	"encoding/binary"
	"fmt"
	"io"
	"os"
	"sync"

	"github.com/fxamacker/cbor/v2"
)

// Call is one call from server code.
type Call struct {
	ID     uint64 `cbor:"id"`
	Method string `cbor:"method"`
	Params []any  `cbor:"params"`
	// Tx is the transaction the call is made in, as begin answered it; nil outside one.
	Tx any `cbor:"tx"`
}

// String is parameter i as a string, or "".
func (c *Call) String(i int) string {
	if i < len(c.Params) {
		if s, ok := c.Params[i].(string); ok {
			return s
		}
	}
	return ""
}

// Arg is parameter i, or nil.
func (c *Call) Arg(i int) any {
	if i < len(c.Params) {
		return c.Params[i]
	}
	return nil
}

// Function answers a call: any value CBOR can carry, Arrow for a table, or an error.
type Function func(c *Call) (any, error)

// Functions are a plugin's functions by name. A plugin with transactions has "begin" (answering the
// transaction's id), "commit" and "rollback"; calls made in a transaction carry its id in Call.Tx.
type Functions map[string]Function

// Arrow is an Arrow IPC stream: a table, read by the server column by column.
type Arrow []byte

var (
	dec, _ = cbor.DecOptions{DefaultMapType: mapType}.DecMode()
	enc, _ = cbor.EncOptions{Time: cbor.TimeRFC3339Nano, TimeTag: cbor.EncTagRequired, BigIntConvert: cbor.BigIntConvertShortest}.EncMode()
)

// Event sends server code something it did not ask for: a change, a message on a channel.
func Event(name string, data any) {
	send(map[string]any{"event": name, "data": data})
}

var out = struct {
	sync.Mutex
	w *bufio.Writer
}{w: bufio.NewWriter(os.Stdout)}

func send(message any) {
	b, err := enc.Marshal(message)
	if err != nil {
		b, _ = enc.Marshal(map[string]any{"id": idOf(message), "error": err.Error()})
	}
	out.Lock()
	defer out.Unlock()
	var n [4]byte
	binary.BigEndian.PutUint32(n[:], uint32(len(b)))
	out.w.Write(n[:])
	out.w.Write(b)
	out.w.Flush()
}

func idOf(message any) any {
	if m, ok := message.(map[string]any); ok {
		return m["id"]
	}
	return nil
}

// Serve answers calls until the server closes stdin.
func Serve(functions Functions) {
	in := bufio.NewReader(os.Stdin)
	for {
		var n [4]byte
		if _, err := io.ReadFull(in, n[:]); err != nil {
			return
		}
		b := make([]byte, binary.BigEndian.Uint32(n[:]))
		if _, err := io.ReadFull(in, b); err != nil {
			return
		}
		var c Call
		if err := dec.Unmarshal(b, &c); err != nil {
			fmt.Fprintln(os.Stderr, "a call that is not CBOR:", err)
			continue
		}
		go answer(functions, &c)
	}
}

func answer(functions Functions, c *Call) {
	defer func() {
		if r := recover(); r != nil {
			send(map[string]any{"id": c.ID, "error": fmt.Sprint(r)})
		}
	}()
	f, ok := functions[c.Method]
	if !ok {
		send(map[string]any{"id": c.ID, "error": "no function " + c.Method})
		return
	}
	v, err := f(c)
	switch {
	case err != nil:
		send(map[string]any{"id": c.ID, "error": err.Error()})
	default:
		if a, ok := v.(Arrow); ok {
			send(map[string]any{"id": c.ID, "arrow": []byte(a)})
		} else {
			send(map[string]any{"id": c.ID, "result": v})
		}
	}
}

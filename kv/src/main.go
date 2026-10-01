// kv: a key-value store kept by the plugin, with transactions, and its contents as an Arrow table.
// An example of a plugin as a program; a real one holds a database connection where this holds a map.
package main

import (
	"bytes"
	"errors"
	"fmt"
	"sort"
	"sync"
	"sync/atomic"

	"github.com/SluurpHQ/plugins/sdk/go"
	"github.com/apache/arrow-go/v18/arrow"
	"github.com/apache/arrow-go/v18/arrow/array"
	"github.com/apache/arrow-go/v18/arrow/decimal128"
	"github.com/apache/arrow-go/v18/arrow/ipc"
	"github.com/apache/arrow-go/v18/arrow/memory"
)

var (
	mu    sync.Mutex
	store = map[string]string{}
	txs   = map[uint64]map[string]string{}
	next  atomic.Uint64
)

func txOf(c *sluurp.Call) (map[string]string, error) {
	if c.Tx == nil {
		return nil, nil
	}
	id, ok := c.Tx.(uint64)
	if !ok {
		return nil, fmt.Errorf("transaction %v is not one of ours", c.Tx)
	}
	t, ok := txs[id]
	if !ok {
		return nil, errors.New("the transaction has ended")
	}
	return t, nil
}

func main() {
	sluurp.Serve(sluurp.Functions{
		"begin": func(c *sluurp.Call) (any, error) {
			mu.Lock()
			defer mu.Unlock()
			id := next.Add(1)
			txs[id] = map[string]string{}
			return id, nil
		},
		"commit": func(c *sluurp.Call) (any, error) {
			mu.Lock()
			defer mu.Unlock()
			t, err := txOf(c)
			if err != nil || t == nil {
				return nil, err
			}
			for k, v := range t {
				store[k] = v
			}
			delete(txs, c.Tx.(uint64))
			return true, nil
		},
		"rollback": func(c *sluurp.Call) (any, error) {
			mu.Lock()
			defer mu.Unlock()
			if id, ok := c.Tx.(uint64); ok {
				delete(txs, id)
			}
			return true, nil
		},
		"set": func(c *sluurp.Call) (any, error) {
			mu.Lock()
			defer mu.Unlock()
			t, err := txOf(c)
			if err != nil {
				return nil, err
			}
			if t == nil {
				t = store
			}
			t[c.String(0)] = c.String(1)
			return true, nil
		},
		"get": func(c *sluurp.Call) (any, error) {
			mu.Lock()
			defer mu.Unlock()
			t, err := txOf(c)
			if err != nil {
				return nil, err
			}
			if v, ok := t[c.String(0)]; ok {
				return v, nil
			}
			if v, ok := store[c.String(0)]; ok {
				return v, nil
			}
			return nil, nil
		},
		// The store as a table, with a big integer and an exact decimal to show they arrive whole.
		"table": func(c *sluurp.Call) (any, error) {
			mu.Lock()
			keys := make([]string, 0, len(store))
			for k := range store {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			values := make([]string, len(keys))
			for i, k := range keys {
				values[i] = store[k]
			}
			mu.Unlock()
			schema := arrow.NewSchema([]arrow.Field{
				{Name: "key", Type: arrow.BinaryTypes.String},
				{Name: "value", Type: arrow.BinaryTypes.String},
				{Name: "big", Type: arrow.PrimitiveTypes.Int64},
				{Name: "price", Type: &arrow.Decimal128Type{Precision: 10, Scale: 2}},
			}, nil)
			b := array.NewRecordBuilder(memory.DefaultAllocator, schema)
			defer b.Release()
			for i := range keys {
				b.Field(0).(*array.StringBuilder).Append(keys[i])
				b.Field(1).(*array.StringBuilder).Append(values[i])
				b.Field(2).(*array.Int64Builder).Append(9007199254740993 + int64(i))
				b.Field(3).(*array.Decimal128Builder).Append(decimal128.FromI64(1999 + int64(i)))
			}
			rec := b.NewRecordBatch()
			defer rec.Release()
			var buf bytes.Buffer
			w := ipc.NewWriter(&buf, ipc.WithSchema(schema))
			if err := w.Write(rec); err != nil {
				return nil, err
			}
			w.Close()
			return sluurp.Arrow(buf.Bytes()), nil
		},
	})
}

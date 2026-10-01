// oracle: Oracle Database for Sluurp apps, with the pure-Go go-ora driver (no Oracle client to install).
// Connects to ORACLE_URL (oracle://user:password@host:1521/service).
package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math/big"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/SluurpHQ/plugins/sdk/go"
	"github.com/fxamacker/cbor/v2"
	_ "github.com/sijms/go-ora/v2"
)

var (
	db   *sql.DB
	mu   sync.Mutex
	txs  = map[uint64]*sql.Tx{}
	next atomic.Uint64
)

// The connection a call runs on: its transaction's, or the pool.
type runner interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func on(c *sluurp.Call) (runner, error) {
	if c.Tx == nil {
		return db, nil
	}
	id, _ := c.Tx.(uint64)
	mu.Lock()
	defer mu.Unlock()
	if t, ok := txs[id]; ok {
		return t, nil
	}
	return nil, errors.New("the transaction has ended")
}

func params(c *sluurp.Call) []any {
	list, _ := c.Arg(1).([]any)
	for i, v := range list {
		if t, ok := v.(cbor.Tag); ok && t.Number == 0 {
			if s, ok := t.Content.(string); ok {
				if d, err := time.Parse(time.RFC3339Nano, s); err == nil {
					list[i] = d
				}
			}
		}
	}
	return list
}

// A NUMBER as CBOR: an integer when it is one, else an exact decimal (tag 4), never a float.
func number(s string) any {
	s = strings.TrimSpace(s)
	exp := 0
	if i := strings.IndexByte(s, '.'); i >= 0 {
		exp = -(len(s) - i - 1)
		s = s[:i] + s[i+1:]
	}
	m, ok := new(big.Int).SetString(s, 10)
	if !ok {
		return s
	}
	if exp == 0 {
		if m.IsInt64() {
			return m.Int64()
		}
		return m
	}
	return cbor.Tag{Number: 4, Content: []any{exp, m}}
}

func query(c *sluurp.Call) (any, error) {
	r, err := on(c)
	if err != nil {
		return nil, err
	}
	rows, err := r.QueryContext(context.Background(), c.String(0), params(c)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	types, _ := rows.ColumnTypes()
	out := []map[string]any{}
	for rows.Next() {
		cells := make([]any, len(types))
		for i, t := range types {
			if t.DatabaseTypeName() == "NUMBER" {
				cells[i] = new(sql.NullString)
			} else {
				cells[i] = new(any)
			}
		}
		if err := rows.Scan(cells...); err != nil {
			return nil, err
		}
		row := map[string]any{}
		for i, t := range types {
			name := strings.ToLower(t.Name())
			switch v := cells[i].(type) {
			case *sql.NullString:
				if v.Valid {
					row[name] = number(v.String)
				} else {
					row[name] = nil
				}
			case *any:
				row[name] = *v
			}
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func main() {
	url := os.Getenv("ORACLE_URL")
	if url == "" {
		fmt.Fprintln(os.Stderr, "ORACLE_URL is not set (oracle://user:password@host:1521/service)")
	}
	var err error
	if db, err = sql.Open("oracle", url); err != nil {
		fmt.Fprintln(os.Stderr, err)
	}
	sluurp.Serve(sluurp.Functions{
		"query": query,
		"execute": func(c *sluurp.Call) (any, error) {
			r, err := on(c)
			if err != nil {
				return nil, err
			}
			res, err := r.ExecContext(context.Background(), c.String(0), params(c)...)
			if err != nil {
				return nil, err
			}
			n, _ := res.RowsAffected()
			return map[string]any{"changes": n}, nil
		},
		"begin": func(c *sluurp.Call) (any, error) {
			t, err := db.BeginTx(context.Background(), nil)
			if err != nil {
				return nil, err
			}
			id := next.Add(1)
			mu.Lock()
			txs[id] = t
			mu.Unlock()
			return id, nil
		},
		"commit":   func(c *sluurp.Call) (any, error) { return end(c, (*sql.Tx).Commit) },
		"rollback": func(c *sluurp.Call) (any, error) { return end(c, (*sql.Tx).Rollback) },
	})
}

func end(c *sluurp.Call, how func(*sql.Tx) error) (any, error) {
	id, _ := c.Tx.(uint64)
	mu.Lock()
	t, ok := txs[id]
	delete(txs, id)
	mu.Unlock()
	if !ok {
		return nil, errors.New("the transaction has ended")
	}
	return true, how(t)
}

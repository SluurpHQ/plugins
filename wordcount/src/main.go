package main

import (
	"encoding/json"
	"io"
	"os"
	"strings"
)

func main() {
	in, _ := io.ReadAll(os.Stdin)
	words := strings.Fields(string(in))
	counts := map[string]int{}
	for _, w := range words {
		counts[strings.ToLower(strings.Trim(w, ".,;:!?"))]++
	}
	json.NewEncoder(os.Stdout).Encode(map[string]any{"words": len(words), "counts": counts, "by": "go"})
}

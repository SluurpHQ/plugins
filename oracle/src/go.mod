module github.com/SluurpHQ/plugins/oracle

go 1.26.4

replace github.com/SluurpHQ/plugins/sdk/go => ../../sdk/go

require (
	github.com/SluurpHQ/plugins/sdk/go v0.0.0-00010101000000-000000000000
	github.com/fxamacker/cbor/v2 v2.9.4
	github.com/sijms/go-ora/v2 v2.9.0
)

require github.com/x448/float16 v0.8.4 // indirect

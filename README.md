# Sluurp plugins

Plugins for [Sluurp](https://sluurp.org), installed into an app with the `sluurp` command:

```sh
sluurp plugin add peppol          # the newest version
sluurp plugin add peppol@^1       # the newest 1.x
sluurp plugin list                # what is installed, and what is here
sluurp plugin update              # each to the newest its range allows
sluurp plugin remove peppol
```

A plugin goes into the app's `plugins/<name>/` folder, and the app's `sluurp-plugins.json` records its version and the checksum of each of its files. Installing again gives exactly the same files, and a file that was changed is refused.

## Plugins here

| Plugin | What it does |
|---|---|
| `peppol` | Invoices as e-invoices in the Peppol BIS Billing 3.0 format (UBL 2.1, EN 16931), offered for issuers in countries that use Peppol |

## How it is laid out

- A folder per plugin, with its files and a `plugin.json`: its name, version, description, main file, the Sluurp versions it runs on (`"sluurp": ">=0.2.0"`), and the plugins it requires, with npm-style ranges (`"requires": { "other": "^1.2.0" }`).
- `index.json` lists every plugin and every released version, with each file's SHA-256.
- Each release is a git tag, `name@version`; `sluurp` downloads a plugin's files at its tag.

## Writing a plugin

A plugin is TypeScript (or JavaScript) run in Sluurp's sandbox: the web's standard objects and `Sluurp` (YAML, TOML, JSON5, XML and the rest), no disk and no network. It imports another plugin as `plugin:name` (or `plugin:name@^1/file.ts`), and its own files as `./file.ts`.

It exports what it provides:

- `extensions` and `transform(source, path)`: a file type Sluurp doesn't know, made into a module.
- `invoiceFormat`: `{ name, label, countries, contentType, extension, build(invoice) }`, an invoice format billing offers beside the PDF.

```sh
sluurp plugin new my-plugin --registry .        # its folder, plugin.json and main file
sluurp plugin release my-plugin --registry .    # checksums into index.json, committed and tagged my-plugin@0.1.0
git push --follow-tags
```

## Your own registry

Keep plugins of your own in a repository laid out the same way. An app takes plugins from it once it is named:

```sh
sluurp plugin registry add your-org/sluurp-plugins
sluurp plugin add your-org/sluurp-plugins:my-plugin
```

A registry is a GitHub `owner/repo`, any git address (`git@gitlab.com:your-org/plugins.git`, `ssh://…`, `https://….git`), or a folder.

A private registry is read with the `git` installed on the machine, with whatever access it already has: an SSH key, a credential manager, `gh auth login`, a deploy key. Where git can't be used, give a token: `SLUURP_PLUGIN_TOKENS=your-org/sluurp-plugins=…` (or `your-org=…`), or `GITHUB_TOKEN`.

A server can narrow the registries its apps may use: `SLUURP_PLUGIN_REGISTRIES=your-org/sluurp-plugins`. Sluurp's own registry is always allowed.

More in the docs: https://sluurp.org/docs/plugins

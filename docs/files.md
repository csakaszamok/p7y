# Files

The **Files** tab of a sandbox's panel shows its files: open folders, upload files (**Upload…**, or drop them on the list, several at once), download a file, or a whole folder as a `.tar` (**Download folder**), make folders and delete.

It shows four folders, the ones that are kept when the sandbox goes into deep sleep or its container is recreated: `/root` (where it opens), `/home`, `/srv` and `/opt`. Anything else in the sandbox container is gone then, so it is not offered here. The files of the apps inside the sandbox (their containers and volumes) are in the sandbox's own Docker: reach them with `docker cp` there, through the terminal, SSH or Docker access.

The sandbox has to be running: asleep, the tab offers to wake it. A file can be up to `FILES_MAX_UPLOAD` (100 MB by default, see [Configuration](configuration.md)).

## API and MCP

| Method | Path | |
|--------|------|-|
| `GET` | `/sandboxes/:name/files?path=/root/app` | The folder's entries (folders first): `name`, `type` (`dir`, `file`, `link`, `other`), `size`, `mtime` |
| `GET` | `/sandboxes/:name/files/content?path=…` | A file's bytes, or a folder as a tar |
| `PUT` | `/sandboxes/:name/files/content?path=…` | Upload: the body is the file (`curl -T report.pdf`) |
| `GET` | `/sandboxes/:name/files/text?path=…` | A text file as `{ path, text }` (UTF-8, up to 1 MB) |
| `POST` | `/sandboxes/:name/files/mkdir` | `{"path": "/srv/data"}` |
| `DELETE` | `/sandboxes/:name/files?path=…` | A file, or a folder with everything in it |

```bash
curl -T notes.md -H "Authorization: Bearer $P7Y_TOKEN" "https://p7y.example.com/sandboxes/p7y-shop/files/content?path=/root/notes.md"
```

A token limited to the sandbox may use all of them. Over [MCP](mcp.md) they are `list_sandbox_files`, `read_sandbox_file`, `write_sandbox_file` (text), `create_sandbox_folder` and `delete_sandbox_file`; a download is left out, since a tool result carries no file.

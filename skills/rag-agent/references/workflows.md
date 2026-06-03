# RAG Agent Workflows

## 1. Discover Clients

```bash
# Check connectivity
rag doctor

# List all clients
rag clients list

# Get details for one client (includes HTTP connection info when ready)
rag clients get --client <clientId>
```

Expected output: JSON with client `id`, `name`, `status`, `online`, `clientHttpBaseUrl`, `clientHttpToken`, etc.

## 2. Execute a Remote Command

```bash
# Run a simple command
rag jobs run --client <clientId> -- node -v

# Run with multiple arguments
rag jobs run --client <clientId> -- powershell -Command "Get-Process | Select-Object -First 5"

# Poll for completion
rag jobs get --client <clientId> --job <jobId>

# Read logs
rag jobs logs --client <clientId> --job <jobId>

# Follow events live (JSON Lines)
rag jobs events --client <clientId> --job <jobId>
```

## 3. Execute a Script

### From a local file

```bash
rag jobs script --client <clientId> --file ./deploy.sh --runtime bash
```

### Inline

```bash
rag jobs script --client <clientId> --inline "
const fs = require('fs');
const files = fs.readdirSync('.');
console.log(JSON.stringify(files));
"
```

## 4. Read a Remote File

```bash
# List available roots
rag files roots --client <clientId>

# Browse directory
rag files list --client <clientId> --root root-0 --path .

# Read file content (JSON wrapped)
rag files read --client <clientId> --root root-0 --path README.md

# Read raw content
rag files read --client <clientId> --root root-0 --path README.md --raw
```

## 5. Write a Remote File

```bash
# Inline content
rag files write --client <clientId> --root root-0 --path config.json --content '{"port":3000}'

# From stdin
echo 'hello world' | rag files write --client <clientId> --root root-0 --path note.txt --stdin
```

## 6. Upload a Local File

```bash
# Upload with default filename (basename of --file)
rag files upload --client <clientId> --root root-0 --path . --file ./app.jar

# Upload with explicit remote filename
rag files upload --client <clientId> --root root-0 --path /tmp --file ./app.jar --filename my-app.jar
```

## 7. Download a Remote File

```bash
rag files download --client <clientId> --root root-0 --path /tmp/report.pdf --output ./report.pdf
```

## 8. Upload and Run a Script

This is a common two-step pattern:

```bash
# Step 1: Upload the script
rag files upload --client <clientId> --root root-0 --path . --file ./deploy.ps1 --filename deploy.ps1

# Step 2: Execute it (adjust runtime and path for the remote OS)
rag jobs run --client <clientId> -- powershell -File deploy.ps1
```

## 9. Expose a Remote Service

```bash
# Expose a local HTTP server
rag frp create --client <clientId> --name web --type tcp --local-port 3000

# Expose with a custom domain (requires HTTP type)
rag frp create --client <clientId> --name preview --type http --local-port 8080 --custom-domain preview.example.com

# Check current mappings
rag frp list --client <clientId>

# Tear down when done
rag frp delete --client <clientId> --mapping <mappingId>
```

The `create` response includes a `publicUrl` if the server assigned one. Share that URL with the user.

## 10. Review Audit History

```bash
# All history
rag tasks list

# Per client
rag tasks list --client <clientId>

# Filter by action type
rag tasks list --action file.write

# Get one record's details
rag tasks get --record <recordId>
```

Note: `tasks` shows completed operations from the server-side audit mirror. Use `jobs` for live/ongoing executions.

## 11. Full Diagnosis Workflow

```bash
# 1. Confirm connectivity
rag doctor

# 2. Check a specific client end-to-end
rag doctor --client <clientId>
# Output includes: server reachable, client online, client HTTP reachable,
# file roots count, FRP mappings count

# 3. Verify file access
rag files roots --client <clientId>
rag files list --client <clientId> --root root-0 --path .

# 4. Verify job execution
rag jobs run --client <clientId> -- node -e "console.log('ok')"
```

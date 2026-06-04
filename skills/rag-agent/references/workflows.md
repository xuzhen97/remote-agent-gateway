# RAG Agent Workflows

## 1. Discover Clients

```bash
node ./dist/rag.cjs doctor
node ./dist/rag.cjs clients list
node ./dist/rag.cjs clients get --client <clientId>
```

Expected output: JSON with client `id`, `name`, `status`, `online`, `clientHttpBaseUrl`, `clientHttpToken`, etc.

## 2. Execute a Remote Command

### Preferred one-step result workflow

```bash
node ./dist/rag.cjs jobs run --client <clientId> --wait --logs -- node -v
```

### Manual multi-step workflow

```bash
node ./dist/rag.cjs jobs run --client <clientId> -- node -v
node ./dist/rag.cjs jobs get --client <clientId> --job <jobId>
node ./dist/rag.cjs jobs logs --client <clientId> --job <jobId>
```

### Live streaming workflow

```bash
node ./dist/rag.cjs jobs run --client <clientId> --events -- node -v
```

## 3. Execute a Script

### From a local file

```bash
node ./dist/rag.cjs jobs script --client <clientId> --file ./deploy.sh --runtime bash
```

### Inline

```bash
node ./dist/rag.cjs jobs script --client <clientId> --inline "console.log(process.platform)"
```

## 4. Read a Remote File

```bash
node ./dist/rag.cjs files roots --client <clientId>
node ./dist/rag.cjs files list --client <clientId> --root root-0 --path .
node ./dist/rag.cjs files read --client <clientId> --root root-0 --path README.md
node ./dist/rag.cjs files read --client <clientId> --root root-0 --path README.md --raw
```

## 5. Write a Remote File

```bash
node ./dist/rag.cjs files write --client <clientId> --root root-0 --path config.json --content '{"port":3000}'
echo 'hello world' | node ./dist/rag.cjs files write --client <clientId> --root root-0 --path note.txt --stdin
```

## 6. Upload a Local File

```bash
node ./dist/rag.cjs files upload --client <clientId> --root root-0 --path . --file ./app.jar
node ./dist/rag.cjs files upload --client <clientId> --root root-0 --path /tmp --file ./app.jar --filename my-app.jar
```

## 7. Download a Remote File

```bash
node ./dist/rag.cjs files download --client <clientId> --root root-0 --path /tmp/report.pdf --output ./report.pdf
```

## 8. Upload and Run a Script

```bash
node ./dist/rag.cjs files upload --client <clientId> --root root-0 --path . --file ./deploy.ps1 --filename deploy.ps1
node ./dist/rag.cjs jobs run --client <clientId> -- powershell -File deploy.ps1
```

## 9. Expose a Remote Service

```bash
node ./dist/rag.cjs frp create --client <clientId> --name web --type tcp --local-port 3000
node ./dist/rag.cjs frp create --client <clientId> --name preview --type http --local-port 8080 --custom-domain preview.example.com
node ./dist/rag.cjs frp list --client <clientId>
node ./dist/rag.cjs frp delete --client <clientId> --mapping <mappingId>
```

## 10. Review Audit History

```bash
node ./dist/rag.cjs tasks list
node ./dist/rag.cjs tasks list --client <clientId>
node ./dist/rag.cjs tasks list --action file.write
node ./dist/rag.cjs tasks get --record <recordId>
```

## 11. Full Diagnosis Workflow

```bash
node ./dist/rag.cjs doctor
node ./dist/rag.cjs doctor --client <clientId>
node ./dist/rag.cjs files roots --client <clientId>
node ./dist/rag.cjs files list --client <clientId> --root root-0 --path .
node ./dist/rag.cjs jobs run --client <clientId> -- node -e "console.log('ok')"
```

# RAG Agent Workflows

## 1. Discover Clients

```bash
node ./run.cjs doctor
node ./run.cjs clients list
node ./run.cjs clients get --client <clientId>
```

Expected output: JSON with client `id`, `name`, `status`, `online`, `clientHttpBaseUrl`, `clientHttpToken`, etc.

## 2. Execute a Remote Command

### Preferred one-step result workflow

```bash
node ./run.cjs jobs run --client <clientId> --wait --logs -- node -v
```

### Manual multi-step workflow

```bash
node ./run.cjs jobs run --client <clientId> -- node -v
node ./run.cjs jobs get --client <clientId> --job <jobId>
node ./run.cjs jobs logs --client <clientId> --job <jobId>
```

### Live streaming workflow

```bash
node ./run.cjs jobs run --client <clientId> --events -- node -v
```

## 3. Execute a Script

### From a local file

```bash
node ./run.cjs jobs script --client <clientId> --file ./deploy.sh --runtime bash
```

### Inline

```bash
node ./run.cjs jobs script --client <clientId> --inline "console.log(process.platform)"
```

## 4. Read a Remote File

```bash
node ./run.cjs files roots --client <clientId>
node ./run.cjs files list --client <clientId> --root root-0 --path .
node ./run.cjs files read --client <clientId> --root root-0 --path README.md
node ./run.cjs files read --client <clientId> --root root-0 --path README.md --raw
```

## 5. Write a Remote File

```bash
node ./run.cjs files write --client <clientId> --root root-0 --path config.json --content '{"port":3000}'
echo 'hello world' | node ./run.cjs files write --client <clientId> --root root-0 --path note.txt --stdin
```

## 6. Upload a Local File

```bash
node ./run.cjs files upload --client <clientId> --root root-0 --path . --file ./app.jar
node ./run.cjs files upload --client <clientId> --root root-0 --path /tmp --file ./app.jar --filename my-app.jar
```

`files upload` 会持续输出进度；大文件/弱网场景下如果命令被外层调用超时中断，重新执行相同命令会优先尝试续传。

## 7. Download a Remote File

```bash
node ./run.cjs files download --client <clientId> --root root-0 --path /tmp/report.pdf --output ./report.pdf
```

## 8. Upload and Run a Script

```bash
node ./run.cjs files upload --client <clientId> --root root-0 --path . --file ./deploy.ps1 --filename deploy.ps1
node ./run.cjs jobs run --client <clientId> -- powershell -File deploy.ps1
```

## 9. Expose a Remote Service

```bash
node ./run.cjs frp create --client <clientId> --name web --type tcp --local-port 3000
node ./run.cjs frp create --client <clientId> --name preview --type http --local-port 8080 --custom-domain preview.example.com
node ./run.cjs frp list --client <clientId>
node ./run.cjs frp delete --client <clientId> --mapping <mappingId>
```

Deletion semantics:
- a successful `frp delete` means the mapping was removed from server/client state,
- the client rebuilt its single `frpc` config/process,
- and the deleted proxy was cleared from the FRPS dashboard/API instead of lingering as `offline`.

## 10. Review Audit History

```bash
node ./run.cjs tasks list
node ./run.cjs tasks list --client <clientId>
node ./run.cjs tasks list --action file.write
node ./run.cjs tasks get --record <recordId>
```

## 11. Full Diagnosis Workflow

```bash
node ./run.cjs doctor
node ./run.cjs doctor --client <clientId>
node ./run.cjs files roots --client <clientId>
node ./run.cjs files list --client <clientId> --root root-0 --path .
node ./run.cjs jobs run --client <clientId> -- node -e "console.log('ok')"
```

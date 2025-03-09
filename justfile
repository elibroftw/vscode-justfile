set windows-shell := ["powershell.exe", "-NoLogo", "-Command"]

hello-world:
    echo "Hello, world!"

with-arg arg:
    Write-Host "Hello, world!"

arch := "wasm"

advanced triple=(arch + "-unknown-unknown") input=(arch / "input.dat"):
  ./test {{triple}}

# The Docker images

The images serve the **web configurator**: the built page and a small web server ([Caddy](https://caddyserver.com/)), listening on port 8080. They are for running the configurator without installing Node or the desktop app.

Two things to know before you use one:

- **The macropad is not in the image.** It is AutoHotkey or PowerShell on Windows and cannot run in a container. The page edits the Open Macro Builder folder on the computer whose browser opens it, wherever the container runs.
- **The page can open a folder only on `https://` or on `localhost`.** That is a browser rule for the File System Access API, in Chrome and Edge. On the same computer, `http://localhost:8080` works. From another device you must put HTTPS in front of the container (see [From another device](#from-another-device)).

## Run it

```
docker run --rm -p 8080:8080 ghcr.io/hotdog-studio/open-macro-builder
```

Open <http://localhost:8080> in Chrome or Edge, press **Open folder** and pick your copy of the repository.

The image runs as an unprivileged user, writes nothing, and needs no volumes or environment variables, so it can be locked down:

```
docker run --rm -p 8080:8080 --read-only --cap-drop ALL ghcr.io/hotdog-studio/open-macro-builder
```

`/healthz` answers `ok` for health checks; the Linux image has a Docker `HEALTHCHECK` that uses it.

### With Compose

```yaml
services:
  open-macro-builder:
    image: ghcr.io/hotdog-studio/open-macro-builder
    ports:
      - "127.0.0.1:8080:8080"
    read_only: true
    cap_drop: [ALL]
    restart: unless-stopped
```

Binding to `127.0.0.1` keeps it to the computer it runs on, which is also the only place plain HTTP is enough.

## Which image

| Platform | Built from | Notes |
| --- | --- | --- |
| `linux/amd64`, `linux/arm64` | [`Dockerfile`](../Dockerfile) | About 90 MB. Also what Docker Desktop on Windows and macOS runs. |
| `windows/amd64` | [`docker/Dockerfile.windows`](../docker/Dockerfile.windows) | A Windows container, on Windows Server Core LTSC 2022: several GB, and only for a Windows host in Windows-container mode whose version matches. Use it where Linux containers are not an option. Not published: [build it yourself](#build-it-yourself). |

## From another device

Serve the container through a reverse proxy that has a certificate the browser trusts, and open the `https://` address. With Caddy on the host, for example:

```
macropad.example.com {
	reverse_proxy 127.0.0.1:8080
}
```

A self-signed certificate works only once the browser has been told to trust it. Over plain `http://` to anything but `localhost`, the page loads and then says it needs Chrome or Edge to open a folder, because the browser hides the folder picker there.

## Build it yourself

From the repository root.

Linux, both architectures:

```
docker buildx build --platform linux/amd64,linux/arm64 -t open-macro-builder .
```

The page is built once, on the machine doing the build, and copied into each architecture's image, so no emulation is needed.

Windows, on a Windows host in Windows-container mode. There is no Node image for Windows, so build the page first:

```
cd configurator; npm ci; npm run build; cd ..
docker build -f docker/Dockerfile.windows -t open-macro-builder:windows .
```

`--build-arg WINDOWS_VERSION=ltsc2025` picks another Windows base; it must be one the [Caddy image](https://hub.docker.com/_/caddy) is published for.

Both images use the same server settings, [`docker/Caddyfile`](../docker/Caddyfile): compression, long-lived caching for the hashed files, and a Content-Security-Policy that lets the page load only its own files.

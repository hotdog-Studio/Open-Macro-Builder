#!/usr/bin/env sh
# Starts a configurator image the locked-down way docs/docker.md recommends and checks that it
# serves the page. The checks run inside the container, so no port is published and the script
# works on a build agent that is itself a container.
#
#   sh docker/smoke.sh <image> [<machine>]
#
# <machine> is what `uname -m` must print in the container (x86_64, aarch64): it proves that the
# image is of the architecture its tag says, and that this host can run it.
set -eu
image="${1:?usage: sh docker/smoke.sh <image> [<machine>]}"
machine="${2:-}"

id="$(docker run -d --rm --read-only --cap-drop ALL --cpus 1 --memory 256m "$image")"
trap 'docker stop -t 2 "$id" >/dev/null 2>&1 || true' EXIT

tries=0
until docker exec "$id" wget -q -O /dev/null http://127.0.0.1:8080/healthz 2>/dev/null; do
    tries=$((tries + 1))
    if [ "$tries" -ge 40 ]; then
        docker logs "$id" 2>&1 | tail -20 || true
        echo "smoke: $image did not answer /healthz within 20 s" >&2
        exit 1
    fi
    sleep 0.5
done

if ! docker exec "$id" wget -q -O - http://127.0.0.1:8080/ | grep -q '<div id="root"'; then
    echo "smoke: $image does not serve the configurator page" >&2
    exit 1
fi

if [ -n "$machine" ]; then
    actual="$(docker exec "$id" uname -m)"
    if [ "$actual" != "$machine" ]; then
        echo "smoke: $image runs as $actual, expected $machine" >&2
        exit 1
    fi
fi
echo "smoke: $image serves the page${machine:+ on $machine}"

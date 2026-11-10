#!/usr/bin/env sh
# Creates the Open Macro Builder job on a Jenkins controller from ci/jenkins-job.xml, or updates
# it when it exists, then starts a branch scan so the first build runs at once.
#
#   JENKINS_USER=<your Jenkins user> JENKINS_TOKEN=<API token or password> sh ci/create-jenkins-job.sh
#
# It also needs JENKINS_URL (the controller) and JENKINS_CREDENTIALS_ID (the id of an SSH key
# credential in Jenkins that can read the repository). Keep those two in local/ci/jenkins.env,
# which git ignores; this script reads it when it exists:
#   JENKINS_URL=https://jenkins.example.com
#   JENKINS_CREDENTIALS_ID=<credential id>
# An API token (Jenkins > your name > Security > API Token) is best; a password works too, using a
# CSRF crumb. The credentials are only read from the environment and passed to curl on stdin,
# never written to disk or shown in the process list. JOB_NAME defaults to open-macro-builder.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
env_file="$here/../local/ci/jenkins.env"
if [ -f "$env_file" ]; then
    # shellcheck disable=SC1090
    . "$env_file"
fi
: "${JENKINS_URL:?set JENKINS_URL, for example in local/ci/jenkins.env}"
: "${JENKINS_CREDENTIALS_ID:?set JENKINS_CREDENTIALS_ID, for example in local/ci/jenkins.env}"
: "${JENKINS_USER:?set JENKINS_USER to your Jenkins user name}"
: "${JENKINS_TOKEN:?set JENKINS_TOKEN to a Jenkins API token or password}"
url="${JENKINS_URL%/}"
job="${JOB_NAME:-open-macro-builder}"
jar="$(mktemp)"
xml="$(mktemp)"
trap 'rm -f "$jar" "$xml"' EXIT
sed "s|@JENKINS_CREDENTIALS_ID@|$JENKINS_CREDENTIALS_ID|" "$here/jenkins-job.xml" > "$xml"

jenkins() {
    printf 'user = "%s:%s"\n' "$JENKINS_USER" "$JENKINS_TOKEN" | curl -fsS -K - -b "$jar" -c "$jar" "$@"
}

# A POST signed in with a password needs a crumb from the same session; one sent with a token
# is accepted either way.
crumbJson="$(jenkins "$url/crumbIssuer/api/json" 2>/dev/null || true)"
crumbField="$(printf '%s' "$crumbJson" | sed -n 's/.*"crumbRequestField":"\([^"]*\)".*/\1/p')"
crumb="$(printf '%s' "$crumbJson" | sed -n 's/.*"crumb":"\([^"]*\)".*/\1/p')"
post() {
    if [ -n "$crumb" ]; then jenkins -X POST -H "$crumbField: $crumb" "$@"; else jenkins -X POST "$@"; fi
}

if jenkins -o /dev/null "$url/job/$job/api/json" 2>/dev/null; then
    post -o /dev/null -H 'Content-Type: application/xml' --data-binary "@$xml" "$url/job/$job/config.xml"
    echo "Updated $url/job/$job/"
else
    post -o /dev/null -H 'Content-Type: application/xml' --data-binary "@$xml" "$url/createItem?name=$job"
    echo "Created $url/job/$job/"
fi
post -o /dev/null "$url/job/$job/build?delay=0"
echo "Branch scan started: $url/job/$job/indexing/console"

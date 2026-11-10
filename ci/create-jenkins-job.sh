#!/usr/bin/env sh
# Creates the Open Macro Builder job on the Jenkins controller from ci/jenkins-job.xml, or
# updates it when it exists, then starts a branch scan so the first build runs at once.
#
#   JENKINS_USER=<your Jenkins user> JENKINS_TOKEN=<API token or password> sh ci/create-jenkins-job.sh
#
# An API token (Jenkins > your name > Security > API Token) is best; a password works too, using a
# CSRF crumb. The credentials are only read from the environment and passed to curl on stdin,
# never written to disk or shown in the process list. JENKINS_URL defaults to
# https://jenkins.example.com and JOB_NAME to open-macro-builder.
set -eu
: "${JENKINS_USER:?set JENKINS_USER to your Jenkins user name}"
: "${JENKINS_TOKEN:?set JENKINS_TOKEN to a Jenkins API token or password}"
url="${JENKINS_URL:-https://jenkins.example.com}"
job="${JOB_NAME:-open-macro-builder}"
xml="$(dirname "$0")/jenkins-job.xml"
jar="$(mktemp)"
trap 'rm -f "$jar"' EXIT

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

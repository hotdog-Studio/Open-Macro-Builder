// Open Macro Builder — Jenkins pipeline: a scripted
// `node { try { stages } catch { } finally { notifyNtfy() } }`, catchError + `error` per test
// stage so every report publishes before the build stops, SonarQube analysis + quality gate,
// cleanup at the end.
//
// Shared controller: this job's globals are OMB_-prefixed so nothing leaks between jobs.
// Recognised globals, all optional:
//   OMB_NTFY_URL           ntfy topic URL for build notifications (none are sent when unset)
//   OMB_SONAR_PROJECT_KEY  overrides sonar.projectKey from sonar-project.properties
//   OMB_WINDOWS_LABEL      label of a Windows agent with Windows PowerShell 5.1, Pester 5.5+ and
//                          AutoHotkey v2. When set, 'Windows Tests' runs the Pester suite there;
//                          when unset the stage is skipped with a log line: the AutoHotkey and
//                          PowerShell versions need Win32 and WinForms, which the Linux agents lack.
//   OMB_SKIP_BROWSER_TESTS set to anything to skip 'Configurator Browser Test', for an agent that
//                          lacks the system libraries headless Chromium needs.
//   OMB_BUILD_WINDOWS_LABEL label of the Windows agent that packages the desktop app (default
//                          windows-x64: Node and Git, nothing else needed)
//   OMB_ARM64_LABEL        label of the arm64 agent that tries the arm64 image (default linux-arm64)
//   OMB_IMAGE              where the images are published (default ghcr.io/hotdog-studio/open-macro-builder)
//   OMB_GITHUB_CREDENTIALS_ID  id of the GitHub credential below (default omb-github)
//   OMB_GIT_CREDENTIALS_ID id of the SSH key that pushes the release tag, when the pipeline may not
//                          read the job's own checkout credential (scm.userRemoteConfigs)
// Credentials: Secret text `ntfy-ci-token`, the ntfy access token. Username with password
// `omb-github`: a GitHub user and a token that may write this repository's contents (releases) and
// write packages (ghcr.io). Without it a develop build ends UNSTABLE and publishes nothing.
//
// VERSION AND RELEASE (docs/releasing.md): every build has a MAJOR.MINOR.PATCH number from
// scripts/ci-version.mjs. MAJOR.MINOR is the version in configurator/package.json; PATCH counts
// the v* git tags. A green build of develop is a release: the Release stage pushes the tag
// v<version> FIRST, then the two Linux images and their shared tags, then the GitHub release with
// the installer and the portable exe. Only develop uses the Windows and the arm64 agent: on any
// other branch the Desktop app, Container images and Release stages are skipped.
//
// STAGES, in order: Checkout → Version → Validate config (scripts/validate-config.mjs: config.json's
// structure, icons, and every action defined in both versions) → Script tests (node:test,
// scripts/*.test.mjs) → Configurator install / lint / test / browser test / build (configurator/,
// installed with ELECTRON_SKIP_BINARY_DOWNLOAD=1 because the agent never starts Electron: the
// desktop-app tests in configurator/e2e skip themselves without the binary) → Windows tests (only
// with OMB_WINDOWS_LABEL) → SonarQube analysis → quality gate → Desktop app (the installer and the portable exe,
// on the Windows agent) → Container images (linux/amd64 and linux/arm64, both built here, the
// arm64 one tried on the arm64 agent) → Release (develop only) → Cleanup. Nothing is deployed
// from here, the macropad runs on the desktop it drives.

// Push the build outcome to the ntfy topic in OMB_NTFY_URL. Missing URL or credential → a log
// line, never a failed build. Only failures/aborts and the first green after a failure notify, so
// a healthy pipeline stays silent.
def notifyNtfy() {
    if (!env.OMB_NTFY_URL) {
        echo 'ntfy: the Jenkins global OMB_NTFY_URL is not set — build notification skipped'
        return
    }
    def result   = currentBuild.currentResult ?: 'SUCCESS'
    def previous = currentBuild.previousBuild?.result
    def fixed    = (result == 'SUCCESS' && previous != null && previous != 'SUCCESS')
    if (result == 'SUCCESS' && !fixed) { return }
    def priority = (result == 'SUCCESS') ? '1' : (result == 'UNSTABLE' ? '3' : '4')
    def title    = fixed ? "${env.JOB_NAME} #${env.BUILD_NUMBER} fixed" : "${env.JOB_NAME} #${env.BUILD_NUMBER} ${result}"
    try {
        withCredentials([string(credentialsId: 'ntfy-ci-token', variable: 'NTFY_TOKEN')]) {
            sh """curl -fsS -m 15 -H "Authorization: Bearer \$NTFY_TOKEN" -H "Title: ${title}" -H "Priority: ${priority}" \\
                  -H "Click: ${env.BUILD_URL}" -H "Tags: ${fixed ? 'white_check_mark' : 'x'}" \\
                  -d "${env.BUILD_URL}console" "\$OMB_NTFY_URL" >/dev/null || true"""
        }
    } catch (ignored) {
        echo 'ntfy: credential ntfy-ci-token not configured — build notification skipped'
    }
}

// Run a test command under catchError so its reports still publish, then let the matching Report
// stage stop the pipeline via `error`.
def runGated(String cmd) {
    catchError(buildResult: 'FAILURE', stageResult: 'FAILURE') {
        sh cmd
    }
}

def stopIfFailed(String what) {
    if (currentBuild.result == 'FAILURE') {
        error "${what} failed — stopping pipeline"
    }
}

// Runs `body` on an agent with `label`, giving the wait for the agent and the work `minutes`
// together. Returns false when no such agent took the work in time (the Windows agent is a desktop
// PC that may be off; a stage never falls back to another machine). A failure of the work itself
// is thrown on.
def onAgent(String label, int minutes, Closure body) {
    def started = false
    try {
        timeout(time: minutes, unit: 'MINUTES') {
            node(label) {
                started = true
                body()
            }
        }
        return true
    } catch (e) {
        if (started) { throw e }
        echo "no '${label}' agent took the work within ${minutes} minutes"
        return false
    }
}

// The build can still release: nothing failed and nothing was skipped.
def green() {
    return currentBuild.result == null || currentBuild.result == 'SUCCESS'
}

properties([disableConcurrentBuilds()])

node {
  try {
    env.CI = 'true'

    def scmVars = null   // what `checkout scm` reports: GIT_COMMIT names the images and their labels
    stage('Checkout') {
        deleteDir()                      // clean workspace
        scmVars = checkout scm
    }

    def version = null     // MAJOR.MINOR.PATCH of this build
    def line = null        // MAJOR.MINOR: SonarQube's version, and an image tag
    def releasing = false  // a green build of this branch is a release
    def gitCred = null     // the checkout credential, reused to fetch and push tags
    stage('Version') {
        // The checkout does not promise tags, so fetch v* with the job's own credential first.
        try { gitCred = scm.userRemoteConfigs[0].credentialsId } catch (ignored) { gitCred = env.OMB_GIT_CREDENTIALS_ID }
        if (gitCred) {
            withCredentials([sshUserPrivateKey(credentialsId: gitCred, keyFileVariable: 'TAG_KEY')]) {
                withEnv(['GIT_SSH_COMMAND=ssh -i "$TAG_KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new']) {
                    sh 'git fetch --no-tags origin "+refs/tags/v*:refs/tags/v*"'
                }
            }
        } else {
            echo 'no checkout credential visible to the pipeline: relying on the tags the checkout brought; no tag will be pushed'
        }
        version = sh(returnStdout: true, script: 'node scripts/ci-version.mjs').trim()
        if (!(version ==~ /\d+\.\d+\.\d+/)) { error "scripts/ci-version.mjs did not print a version: '${version}'" }
        line = version.tokenize('.')[0..1].join('.')
        env.APP_VERSION = version
        sh 'echo "version: $APP_VERSION (counting from $(node scripts/ci-version.mjs --base))"'

        def verdict = sh(returnStatus: true, script: 'node scripts/ci-release.mjs --check')
        if (verdict != 0 && verdict != 3) { error "scripts/ci-release.mjs --check failed (exit ${verdict})" }
        releasing = (verdict == 0)
        // Only a release owns its number: another branch would show the number develop takes next.
        if (releasing) { currentBuild.displayName = "#${env.BUILD_NUMBER} v${version}" }
    }

    stage('Validate config') {
        // config.json drives both versions; the validator needs only Node (no Windows).
        runGated('mkdir -p results && node scripts/validate-config.mjs config.json > results/validate-config.txt 2>&1; s=$?; cat results/validate-config.txt; exit $s')
        archiveArtifacts artifacts: 'results/validate-config.txt', allowEmptyArchive: true
        stopIfFailed('Config validation')
    }

    stage('Run Script Tests') {
        // node:test specs for the scripts: junit for Jenkins, spec for the log, lcov coverage for
        // SonarQube (sonar.javascript.lcov.reportPaths).
        runGated('mkdir -p results/node coverage && node --test --experimental-test-coverage --test-reporter=spec --test-reporter-destination=stdout --test-reporter=junit --test-reporter-destination=results/node/test-results.xml --test-reporter=lcov --test-reporter-destination=coverage/lcov.info "scripts/*.test.mjs"')
    }

    stage('Report Script Tests') {
        junit testResults: 'results/node/test-results.xml', skipPublishingChecks: true, allowEmptyResults: true
        stopIfFailed('Script tests')
    }

    stage('Configurator Install') {
        // The Linux agent never starts Electron, so skip its binary download; test, lint and build
        // work without it.
        runGated('cd configurator && ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci')
        stopIfFailed('Configurator install')
    }

    stage('Configurator Lint') {
        runGated('cd configurator && npm run lint')
        stopIfFailed('Configurator lint')
    }

    stage('Configurator Test') {
        // Vitest: junit for Jenkins, the default reporter for the log, lcov for SonarQube
        // (coverage/configurator/lcov.info, set in configurator/vite.config.ts).
        runGated('mkdir -p results/configurator && cd configurator && npx vitest run --coverage --reporter=default --reporter=junit --outputFile.junit=../results/configurator/junit.xml')
        junit testResults: 'results/configurator/junit.xml', skipPublishingChecks: true, allowEmptyResults: true
        stopIfFailed('Configurator tests')
    }

    stage('Configurator Browser Test') {
        // The same app in headless Chromium, where a drag is a real mouse press, move and release
        // (configurator/vitest.browser.config.ts). Its coverage goes to its own lcov file
        // (coverage/configurator-browser/lcov.info), which SonarQube adds to the unit tests' one.
        // `playwright install chromium` downloads the browser into the agent's cache (a no-op once
        // it is there). Chromium also needs system libraries; an agent without them fails here
        // with Playwright's list of what is missing: install them once on the agent, as root, with
        // `npx playwright install-deps chromium`, or set OMB_SKIP_BROWSER_TESTS until then.
        if (env.OMB_SKIP_BROWSER_TESTS) {
            echo 'Skipping the configurator browser tests — the Jenkins global OMB_SKIP_BROWSER_TESTS is set'
        } else {
            runGated('mkdir -p results/configurator && cd configurator && npx playwright install chromium && npx vitest run --config vitest.browser.config.ts --coverage --reporter=default --reporter=junit --outputFile.junit=../results/configurator/browser-junit.xml')
            junit testResults: 'results/configurator/browser-junit.xml', skipPublishingChecks: true, allowEmptyResults: true
            stopIfFailed('Configurator browser tests')
        }
    }

    stage('Configurator Build') {
        runGated('cd configurator && npm run build')
        stopIfFailed('Configurator build')
    }

    stage('Windows Tests') {
        // The Pester suite (powershell/tests) exercises the PowerShell version against real Win32,
        // WinForms and AutoHotkey, so it needs a Windows agent. -Ci writes JUnit XML and leaves out
        // the Integration-tagged tests, which open windows and send real keys.
        if (env.OMB_WINDOWS_LABEL) {
            node(env.OMB_WINDOWS_LABEL) {
                try {
                    deleteDir()
                    checkout scm
                    catchError(buildResult: 'FAILURE', stageResult: 'FAILURE') {
                        bat 'powershell -NoProfile -ExecutionPolicy Bypass -File powershell\\tests\\run.ps1 -Ci'
                    }
                    junit testResults: 'results/pester/test-results.xml', skipPublishingChecks: true, allowEmptyResults: true
                } finally {
                    cleanWs(notFailBuild: true)
                }
            }
            stopIfFailed('Windows tests')
        } else {
            echo 'Skipping Windows tests — the Jenkins global OMB_WINDOWS_LABEL is not set (the PowerShell and AutoHotkey versions need a Windows agent)'
        }
    }

    stage('SonarQube Analysis') {
        def scannerHome = tool 'SonarScanner'
        def keyArg = env.OMB_SONAR_PROJECT_KEY ? "-Dsonar.projectKey=${env.OMB_SONAR_PROJECT_KEY}" : ''
        withSonarQubeEnv() {
            // MAJOR.MINOR, not the full number: SonarQube's new-code window starts again at each
            // new version, and that should be when the maintainer moves the version, not every build.
            sh "${scannerHome}/bin/sonar-scanner ${keyArg} -Dsonar.projectVersion=${line}"
        }
    }

    stage('SonarQube Quality Gate') {
        // Needs the SonarQube webhook pointing at http://<jenkins-host>/sonarqube-webhook/
        // or this waits until the timeout and the build ends ABORTED.
        timeout(time: 2, unit: 'MINUTES') {
            def qg = waitForQualityGate()
            if (qg.status != 'OK') {
                error "Quality gate failed: ${qg.status}"
            }
        }
    }

    stage('Desktop App') {
        // The installer and the portable exe (configurator/electron-builder.yml), which only
        // Windows can build. They carry this build's number: npm version writes it into the
        // workspace's package.json, and nothing is committed. The agent is a desktop PC that may
        // be off, hence the long wait.
        def label = env.OMB_BUILD_WINDOWS_LABEL ?: 'windows-x64'
        if (!releasing) {
            echo "Skipping the desktop app: only develop builds on the '${label}' agent"
        } else if (!onAgent(label, 45) {
            try {
                deleteDir()
                checkout scm
                // electron-builder fetches the Electron it packs by itself; npm need not.
                withEnv(['ELECTRON_SKIP_BINARY_DOWNLOAD=1']) {
                    bat '''
                        cd configurator
                        call npm ci || exit /b 1
                        call npm version %APP_VERSION% --no-git-tag-version --allow-same-version || exit /b 1
                        call npm run dist || exit /b 1
                    '''
                }
                stash name: 'desktop', includes: 'configurator/release/*.exe'
            } finally {
                cleanWs(notFailBuild: true)
            }
        }) {
            unstable "the desktop app was not built (no '${label}' agent): nothing is released"
        }
    }

    def sha8 = scmVars?.GIT_COMMIT ? scmVars.GIT_COMMIT.substring(0, 8) : 'unknown'
    def built = "omb-build:${sha8}"   // the images of this build, here: <built>-amd64 and <built>-arm64
    stage('Container Images') {
        // The page is built once (the Dockerfile's build stage runs on this machine) and copied
        // onto each architecture's web server, so the arm64 image needs no emulation and no build
        // on the arm64 agent. Each image is then started and asked for the page (docker/smoke.sh).
        if (!releasing) {
            echo 'Skipping the container images: only develop builds them'
        } else withEnv(["BUILT=${built}", "REVISION=${scmVars?.GIT_COMMIT ?: 'unknown'}"]) {
            runGated('''
                for arch in amd64 arm64; do
                    docker buildx build --platform "linux/$arch" \\
                        --label "org.opencontainers.image.version=$APP_VERSION" \\
                        --label "org.opencontainers.image.revision=$REVISION" \\
                        -t "$BUILT-$arch" --load . || exit 1
                done
                sh docker/smoke.sh "$BUILT-amd64" x86_64
            ''')
            stopIfFailed('Container images')
            // The arm64 image runs only on arm64, so it travels to that agent as a file.
            sh 'docker save "$BUILT-arm64" | gzip > omb-arm64.tar.gz'
            stash name: 'arm64-image', includes: 'omb-arm64.tar.gz,docker/smoke.sh'
            sh 'rm -f omb-arm64.tar.gz'
            def label = env.OMB_ARM64_LABEL ?: 'linux-arm64'
            def tried = onAgent(label, 20) {
                try {
                    deleteDir()
                    unstash 'arm64-image'
                    sh 'gunzip -c omb-arm64.tar.gz | docker load && sh docker/smoke.sh "$BUILT-arm64" aarch64'
                } finally {
                    sh 'docker image rm "$BUILT-arm64" >/dev/null 2>&1 || true'
                    deleteDir()
                }
            }
            if (!tried) {
                unstable "the arm64 image was not tried (no '${label}' agent): nothing is released"
            }
        }
    }

    stage('Release') {
        def image = env.OMB_IMAGE ?: 'ghcr.io/hotdog-studio/open-macro-builder'
        def githubCred = env.OMB_GITHUB_CREDENTIALS_ID ?: 'omb-github'
        // Look for the GitHub credential before anything is tagged: a number is taken only by a
        // build that can publish under it.
        def haveGithub = false
        if (releasing && green() && gitCred) {
            try {
                withCredentials([usernamePassword(credentialsId: githubCred, usernameVariable: 'GITHUB_USER', passwordVariable: 'GITHUB_TOKEN')]) {
                    haveGithub = true
                }
            } catch (ignored) {
                haveGithub = false
            }
        }
        if (!releasing) {
            echo "no release for branch '${env.BRANCH_NAME}': only develop releases"
        } else if (!green()) {
            echo "Skipping release: the build result is ${currentBuild.result}"
        } else if (!gitCred) {
            unstable 'no checkout credential visible to the pipeline: no tag, nothing published (approve scm.userRemoteConfigs in Manage Jenkins > In-process Script Approval, or set OMB_GIT_CREDENTIALS_ID)'
        } else if (!haveGithub) {
            unstable "no GitHub credential '${githubCred}' (Username with password: a GitHub user and a token with contents and packages write): no tag, nothing published"
        } else {
            // 1. The tag. A tag already on this commit is a rebuild; one on another commit exits 4.
            withCredentials([sshUserPrivateKey(credentialsId: gitCred, keyFileVariable: 'TAG_KEY')]) {
                withEnv(['GIT_SSH_COMMAND=ssh -i "$TAG_KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new', "VERSION=${version}"]) {
                    sh 'node scripts/ci-release.mjs tag'
                }
            }
            unstash 'desktop'
            withCredentials([usernamePassword(credentialsId: githubCred, usernameVariable: 'GITHUB_USER', passwordVariable: 'GITHUB_TOKEN')]) {
                withEnv(["VERSION=${version}", "LINE=${line}", "IMAGE=${image}", "BUILT=${built}"]) {
                    // 2. The images: one tag per architecture, then the tags people pull, each
                    // naming both. The login lives in a folder of its own and goes with it.
                    sh '''
                        set -eu
                        export DOCKER_CONFIG="$PWD/.docker-release"
                        mkdir -p "$DOCKER_CONFIG"
                        trap 'rm -rf "$DOCKER_CONFIG"' EXIT
                        printf '%s' "$GITHUB_TOKEN" | docker login ghcr.io -u "$GITHUB_USER" --password-stdin
                        for arch in amd64 arm64; do
                            docker tag "$BUILT-$arch" "$IMAGE:$VERSION-$arch"
                            docker push "$IMAGE:$VERSION-$arch"
                        done
                        docker buildx imagetools create -t "$IMAGE:$VERSION" -t "$IMAGE:$LINE" -t "$IMAGE:latest" \\
                            "$IMAGE:$VERSION-amd64" "$IMAGE:$VERSION-arm64"
                    '''
                    // 3. The GitHub release, last: when it shows up, everything it names is there.
                    sh 'node scripts/ci-release.mjs github configurator/release/*.exe'
                }
            }
        }
    }

    stage('Cleanup') {
        // This build's images, under their local and their published names.
        sh 'docker image ls --format "{{.Repository}}:{{.Tag}}" | grep -E "^(omb-build|ghcr\\.io/.+/open-macro-builder):" | xargs -r docker image rm >/dev/null 2>&1 || true'
        cleanWs(cleanWhenNotBuilt: false,
            deleteDirs: true,
            disableDeferredWipeout: true,
            notFailBuild: true,
            patterns: [[pattern: '.gitignore', type: 'INCLUDE'],
                       [pattern: '.propsfile', type: 'EXCLUDE']])
    }
  } catch (e) {
    currentBuild.result = currentBuild.result ?: 'FAILURE'
    throw e
  } finally {
    notifyNtfy()
  }
}

// Open Macro Builder — Jenkins pipeline: a scripted
// `node { try { stages } catch { } finally { notifyNtfy() } }`, catchError + `error` per test
// stage so every report publishes before the build stops, SonarQube analysis + quality gate,
// cleanup at the end.
//
// Shared controller: this job's globals are OMB_-prefixed so nothing leaks between jobs.
// Recognised globals, all optional:
//   OMB_NTFY_URL           ntfy topic URL for build notifications (none are sent when unset)
//   OMB_SONAR_PROJECT_KEY  overrides sonar.projectKey from sonar-project.properties
//   OMB_WINDOWS_LABEL      label of the Windows agent (default windows-x64). It runs the Pester
//                          suite (every branch) and packages the desktop app (develop), so it needs
//                          Windows PowerShell 5.1, Pester 6.2.0+ installed for all users, AutoHotkey
//                          v2, Node and Git.
//   OMB_WINDOWS_DESKTOP_LABEL  label of the Windows agent with a real, logged-in desktop that runs
//                          the Integration tests, the end-to-end test and the configurator's tests, the
//                          desktop-app suite among them (default windows-desktop), on every branch. It
//                          needs what OMB_WINDOWS_LABEL needs, plus Python on PATH, and it must reach
//                          the npm registry, the Electron download and Playwright's Chromium download.
//   OMB_SKIP_BROWSER_TESTS set to anything to skip 'Configurator Browser Test', for an agent that
//                          lacks the system libraries headless Chromium needs.
//   OMB_ARM64_LABEL        label of the arm64 agent that tries the arm64 image (default linux-arm64)
//   OMB_IMAGE              where the images are published (default ghcr.io/hotdog-studio/open-macro-builder)
//   OMB_REGISTRY           host[:port] of a second, private registry that also gets the linux/amd64
//                          image of every release, as <version> and latest (none when unset). It
//                          must take a push without a login.
//   OMB_REGISTRY_REPO      the repository there (default hotdogstudio/open-macro-builder)
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
// the installer and the portable exe. Only develop builds the desktop app, the images and the
// release: on any other branch the Desktop app, Container images and Release stages are skipped,
// and the arm64 agent is not used. The Windows tests, the Windows Integration tests, the end-to-end
// test and the Windows configurator tests run on every branch, so a branch proves itself on the
// Windows agents before it is merged; on develop any of them that fails, or that found no agent,
// stops the release.
//
// STAGES, in order: Checkout → Version (on develop it also checks that CHANGELOG.md has the heading of
// the version: scripts/ci-release.mjs changelog) → Validate config (scripts/validate-config.mjs:
// config.json's structure, icons, and every action defined in both versions) → Script tests (node:test,
// scripts/*.test.mjs) → Configurator install / lint / test / browser test / build (configurator/,
// without the Electron binary, which nothing on this agent fetches: npm ci does not, and the
// desktop-app tests in configurator/e2e, which would, run only in the Windows configurator stage
// below) → Windows tests (the Pester suite, on the Windows agent, every
// branch) → Windows integration tests (the Pester tests tagged Integration, which need a real
// desktop, on the desktop agent, every branch) → Windows end-to-end (the real macropad on the
// desktop agent, every branch) → Windows configurator tests (the unit, browser and desktop-app
// suites with the Electron binary, which the stage downloads with install-electron right after npm ci,
// on the desktop agent, every branch) → SonarQube analysis →
// quality gate → Desktop app (the installer and the portable exe, on the Windows agent, develop
// only) → Container images (linux/amd64 and linux/arm64, both built here, the arm64 one tried on
// the arm64 agent, develop only) → Release (develop only) → Cleanup. Nothing is deployed
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
// together. Returns false when no such agent took the work in time (the Windows agent is a VM meant
// to be always on, but it has one executor, which another job's build may hold, and it can be
// offline, while it restarts for example; a stage never falls back to another machine). A failure
// of the work itself is thrown on.
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

// Checks this build out into the workspace of a Windows stage. A program that an earlier build left
// working in the workspace keeps Windows from removing the folder itself, though not what is in it:
// the stage then checks out into the held folder, and removes what is not part of the checkout, so
// that nothing left there (an old result file) passes for this build's. An abort or a timeout while
// the folder is removed is thrown on. Both Windows labels are one machine, so the four Windows
// stages (tests, Integration tests, end-to-end, configurator tests) share the workspace.
def checkoutIntoWorkspace() {
    try {
        deleteDir()
    } catch (org.jenkinsci.plugins.workflow.steps.FlowInterruptedException e) {
        throw e
    } catch (e) {
        echo "the workspace could not be removed, so something still works in it (${e.message}); checking out into it"
    }
    checkout scm
    if (bat(returnStatus: true, script: 'git clean -ffdx') != 0) { echo 'git clean could not remove everything that is not part of the checkout' }
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
        // A release needs the heading of its version in CHANGELOG.md and nothing left under
        // Unreleased: a build without them stops here and takes no number (docs/releasing.md).
        // The version was checked above to be digits and dots, so it is safe in the command.
        if (releasing) {
            def changelog = sh(returnStatus: true, script: "mkdir -p results && VERSION=${version} node scripts/ci-release.mjs changelog 2>results/changelog-problem.txt")
            if (changelog != 0) {
                def reason = fileExists('results/changelog-problem.txt') ? readFile('results/changelog-problem.txt').trim() : ''
                error "CHANGELOG.md is not ready to release ${version} (exit ${changelog}): ${reason}"
            }
        }
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
        // The Linux agent never starts Electron, and nothing here downloads its binary: npm ci does not
        // (the electron package has no install script), and the binary is fetched only when something
        // requires the electron module (its index.js) or runs install-electron. Here nothing does: the
        // unit tests mock the module, and the desktop-app suite, which requires it, runs only in the
        // Windows configurator stage. Test, lint and build work without it.
        runGated('cd configurator && npm ci')
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
        // the Integration-tagged tests, which open windows and send real keys. It runs on every
        // branch, so a branch's tests prove themselves on the agent before it is merged.
        // The same run measures how much of the PowerShell version's code the suite executes
        // (powershell/lib, powershell/commands, config.ps1): the console shows a line "Covered N% /
        // 75%. ... analyzed commands in ... files." (75 is Pester's target; nothing fails on it), and
        // the JaCoCo file results/pester/coverage.xml is archived. A run that stops early writes no
        // such file, hence allowEmptyArchive.
        // The agent may be busy with another build or offline (onAgent), hence the long wait. Like
        // the end-to-end stage, it can start in a workspace that an earlier build still holds
        // (checkoutIntoWorkspace); what that build left working there is ended by the end-to-end
        // stage's first clean-up.
        def label = env.OMB_WINDOWS_LABEL ?: 'windows-x64'
        if (!onAgent(label, 45) {
            try {
                checkoutIntoWorkspace()
                catchError(buildResult: 'FAILURE', stageResult: 'FAILURE') {
                    bat 'powershell -NoProfile -ExecutionPolicy Bypass -File powershell\\tests\\run.ps1 -Ci'
                }
                junit testResults: 'results/pester/test-results.xml', skipPublishingChecks: true, allowEmptyResults: true
                archiveArtifacts artifacts: 'results/pester/coverage.xml', allowEmptyArchive: true
            } finally {
                cleanWs(notFailBuild: true)
            }
        }) {
            unstable "the Windows tests did not run (no '${label}' agent)${releasing ? ': nothing is released' : ''}"
        }
        stopIfFailed('Windows tests')
    }

    stage('Windows Integration Tests') {
        // The tests tagged Integration (powershell/tests): real windows, real key events, the real
        // default playback device. The Windows Tests stage leaves them out, because they need a
        // logged-in desktop. They run on every branch, on the desktop agent, one stage at a time
        // with the end-to-end stage after this one: the desktop is shared and nothing else may use
        // it meanwhile. Like the Windows Tests stage, it starts in a clean checkout and gives the
        // wait for the agent and the run 45 minutes together.
        def label = env.OMB_WINDOWS_DESKTOP_LABEL ?: 'windows-desktop'
        if (!onAgent(label, 45) {
            try {
                checkoutIntoWorkspace()
                catchError(buildResult: 'FAILURE', stageResult: 'FAILURE') {
                    bat 'powershell -NoProfile -ExecutionPolicy Bypass -File powershell\\tests\\run.ps1 -Ci -Integration'
                }
                junit testResults: 'results/pester/integration-results.xml', skipPublishingChecks: true, allowEmptyResults: true
            } finally {
                cleanWs(notFailBuild: true)
            }
        }) {
            unstable "the Integration tests did not run (no '${label}' agent)${releasing ? ': nothing is released' : ''}"
        }
        stopIfFailed('Windows integration tests')
    }

    stage('Windows End-to-End') {
        // The end-to-end test (powershell/tests/EndToEnd.Tests.ps1): the real macropad, both
        // versions, on a real desktop, driven by real key presses. It runs on every branch, so a
        // branch proves itself on the VM before it is merged. It needs a logged-in desktop that
        // the next build inherits: the test closes what it opens, also when a case fails. Its
        // own limit is 20 minutes; the stage gives the wait for the agent and the run 45. An abort
        // or a timeout ends the test's process tree, so the stage runs the test's own clean-up
        // (run.ps1 -EndToEndCleanup: leftover processes, windows, virtual desktops, held keys,
        // the run's folder; only what the run's state file shows is still the run's) before the
        // test and again after it, whatever happened. The clean-up exits 1 when it could not do
        // everything, and that marks the build failed, as a failed test does.
        // A program that an earlier build left working in the workspace keeps Windows from removing
        // the folder itself, though not what is in it. The stage then goes on: a held, empty folder
        // can be checked out into, and the first clean-up, which then has its code, ends what an
        // earlier build left there (-EarlierBuilds) and prints what it was. What it cleared does not
        // fail this build.
        def label = env.OMB_WINDOWS_DESKTOP_LABEL ?: 'windows-desktop'
        def cleanUp = 'powershell -NoProfile -ExecutionPolicy Bypass -File powershell\\tests\\run.ps1 -EndToEndCleanup'
        if (!onAgent(label, 45) {
            try {
                checkoutIntoWorkspace()
                catchError(buildResult: 'FAILURE', stageResult: 'FAILURE', message: 'the clean-up before the end-to-end test failed') {
                    bat cleanUp + ' -EarlierBuilds'
                }
                catchError(buildResult: 'FAILURE', stageResult: 'FAILURE') {
                    bat 'powershell -NoProfile -ExecutionPolicy Bypass -File powershell\\tests\\run.ps1 -Ci -EndToEnd'
                }
                junit testResults: 'results/pester/end-to-end-results.xml', skipPublishingChecks: true, allowEmptyResults: true
            } finally {
                catchError(buildResult: 'FAILURE', stageResult: 'FAILURE', message: 'the clean-up after the end-to-end test failed') {
                    bat cleanUp
                }
                cleanWs(notFailBuild: true)
            }
        }) {
            unstable "the end-to-end test did not run (no '${label}' agent)${releasing ? ': nothing is released' : ''}"
        }
        stopIfFailed('Windows end-to-end test')
    }

    stage('Windows Configurator Tests') {
        // The configurator's three Vitest suites, on the desktop agent, every branch: the unit tests
        // (also their Windows-only cases, such as the real process list), the browser tests (headless
        // Chromium, so no window) and the desktop-app tests (configurator/e2e), which start the real
        // Electron app and drive its window, so they need the logged-in desktop. The Linux stages
        // above skip those and the Windows-only cases. No coverage here: SonarQube keeps the Linux
        // figures. The suites run one after the other, each under its own catchError, so that a red
        // one does not hide the next; OMB_REQUIRE_ELECTRON=1 makes the desktop-app suite fail in place
        // of skipping itself when the agent has no Electron binary or no display.
        // Downloads: npm ci puts node_modules in the workspace (cleanWs removes it); install-electron
        // puts the Electron binary in node_modules\electron\dist from the zip it keeps in the agent
        // user's own cache (%LOCALAPPDATA%\electron\Cache), and Playwright's Chromium goes to
        // %LOCALAPPDATA%\ms-playwright: the next build finds both caches.
        // What the suites listen on stays on loopback (Vite's server for the browser tests, the
        // inspector and debugging ports of Playwright's Electron launch). Every window is closed by
        // the suite itself, also when a case fails; an abort or a timeout ends the processes of the
        // build, and the clean-up after the suites stops whatever still runs from the workspace
        // (Electron) or from Playwright's browser folder (Chromium), whatever happened.
        // An abort or the stage's timeout during the install or a suite is not caught by its
        // catchError (catchInterruptions: false, set because the plugin's default has changed between
        // its versions; it rethrows only those interruptions, so a failed suite is still caught and
        // the next one runs): the suites after it do not start, the clean-up in `finally` runs (after
        // a timeout, Jenkins gives the stage's body 60 s more before it ends it by force; the clean-up
        // takes seconds), and the build ends as Jenkins ends an aborted or timed-out build.
        def label = env.OMB_WINDOWS_DESKTOP_LABEL ?: 'windows-desktop'
        def junits = 'results/configurator/windows-junit.xml,results/configurator/windows-browser-junit.xml,results/configurator/electron-junit.xml'
        def vitestRun = { String config, String report ->
            "call npx vitest run ${config}--reporter=default --reporter=junit --outputFile.junit=../results/configurator/${report}"
        }
        if (!onAgent(label, 60) {
            try {
                checkoutIntoWorkspace()
                def installed = false
                catchError(buildResult: 'FAILURE', stageResult: 'FAILURE', catchInterruptions: false, message: 'the install of the configurator on the Windows agent failed') {
                    bat 'if not exist results\\configurator mkdir results\\configurator'
                    dir('configurator') {
                        // npm ci does not fetch the Electron binary: the electron package has no install
                        // script, and its index.js downloads the binary the first time anything requires it,
                        // which would be inside the first desktop-app test's time limit. install-electron
                        // (the package's own bin) downloads it here instead, or finds it in place and does
                        // nothing; a failed download ends the install with its own line.
                        // npm.cmd and npx.cmd turn the batch's echo off, so each later line turns it on again
                        // to show in the console; the binary's own line says whether it is in place.
                        bat '''
                            call npm ci || exit /b 1
                            @echo on
                            call npx --no install-electron || (echo the Electron binary could not be downloaded & exit /b 1)
                            if exist node_modules\\electron\\dist\\electron.exe (echo the Electron binary is in place) else (echo the Electron binary is missing after install-electron & exit /b 1)
                            @echo on
                            call npx playwright install chromium || exit /b 1
                        '''
                    }
                    installed = true
                }
                if (installed) {
                    dir('configurator') {
                        catchError(buildResult: 'FAILURE', stageResult: 'FAILURE', catchInterruptions: false, message: 'the configurator unit tests failed on Windows') {
                            bat vitestRun('', 'windows-junit.xml')
                        }
                        catchError(buildResult: 'FAILURE', stageResult: 'FAILURE', catchInterruptions: false, message: 'the configurator browser tests failed on Windows') {
                            bat vitestRun('--config vitest.browser.config.ts ', 'windows-browser-junit.xml')
                        }
                        catchError(buildResult: 'FAILURE', stageResult: 'FAILURE', catchInterruptions: false, message: 'the configurator desktop-app tests failed') {
                            withEnv(['OMB_REQUIRE_ELECTRON=1']) {
                                bat vitestRun('--config vitest.electron.config.ts ', 'electron-junit.xml')
                            }
                        }
                    }
                }
                junit testResults: junits, skipPublishingChecks: true, allowEmptyResults: true
            } finally {
                catchError(buildResult: 'FAILURE', stageResult: 'FAILURE', message: 'the clean-up after the configurator tests failed') {
                    powershell '''
                        $root = $env:WORKSPACE.TrimEnd([char]92) + [char]92
                        $left = @(Get-CimInstance Win32_Process | Where-Object {
                            $_.ExecutablePath -and ($_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or $_.ExecutablePath -like '*ms-playwright*')
                        })
                        foreach ($p in $left) {
                            Write-Output "stopping $($p.Name) ($($p.ProcessId)), left by the configurator tests: $($p.ExecutablePath)"
                            Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
                        }
                    '''
                }
                cleanWs(notFailBuild: true)
            }
        }) {
            unstable "the configurator tests did not run on Windows (no '${label}' agent)${releasing ? ': nothing is released' : ''}"
        }
        stopIfFailed('Windows configurator tests')
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
        // workspace's package.json, and nothing is committed. The agent may be busy with another
        // build or offline (onAgent), hence the long wait.
        def label = env.OMB_WINDOWS_LABEL ?: 'windows-x64'
        if (!releasing) {
            echo "Skipping the desktop app: only develop builds on the '${label}' agent"
        } else if (!onAgent(label, 45) {
            try {
                deleteDir()
                checkout scm
                // electron-builder fetches the Electron it packs by itself; npm ci fetches none (the
                // electron package has no install script).
                bat '''
                    cd configurator
                    call npm ci || exit /b 1
                    call npm version %APP_VERSION% --no-git-tag-version --allow-same-version || exit /b 1
                    call npm run dist || exit /b 1
                '''
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
    // Where a release publishes them; Cleanup removes the same names.
    def image = env.OMB_IMAGE ?: 'ghcr.io/hotdog-studio/open-macro-builder'
    def mirror = env.OMB_REGISTRY ? "${env.OMB_REGISTRY}/${env.OMB_REGISTRY_REPO ?: 'hotdogstudio/open-macro-builder'}" : null
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
                        --build-arg "APP_VERSION=$APP_VERSION" \\
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
            // 4. The second registry, when there is one. The release is already out, so a
            // failure here leaves the build UNSTABLE and takes nothing back. latest goes last:
            // it is the tag a host that follows the registry watches. Each push has five minutes,
            // so a registry that does not answer cannot hold the build.
            if (!mirror) {
                echo 'no second registry: the Jenkins global OMB_REGISTRY is not set'
            } else {
                catchError(buildResult: 'UNSTABLE', stageResult: 'UNSTABLE', message: "the image was not pushed to ${mirror}") {
                    withEnv(["VERSION=${version}", "MIRROR=${mirror}", "BUILT=${built}"]) {
                        sh '''
                            set -eu
                            for tag in "$VERSION" latest; do
                                docker tag "$BUILT-amd64" "$MIRROR:$tag"
                                timeout 300 docker push "$MIRROR:$tag"
                            done
                        '''
                    }
                }
            }
        }
    }

    stage('Cleanup') {
        // The images this job made, under their local and their published names, and no others.
        withEnv(["NAMES=omb-build ${image} ${mirror ?: ''}"]) {
            sh 'for name in $NAMES; do docker image ls --format "{{.Repository}}:{{.Tag}}" "$name"; done | grep -v "<none>" | xargs -r docker image rm >/dev/null 2>&1 || true'
        }
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

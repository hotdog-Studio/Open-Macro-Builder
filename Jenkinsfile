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
// Credentials: Secret text `ntfy-ci-token`, the ntfy access token.
//
// STAGES, in order: Checkout → Validate config (scripts/validate-config.mjs: config.json's
// structure, icons, and every action defined in both versions) → Script tests (node:test,
// scripts/*.test.mjs) → Configurator install / lint / test / build (configurator/, installed with
// ELECTRON_SKIP_BINARY_DOWNLOAD=1 because the agent never starts Electron) → Windows tests (only
// with OMB_WINDOWS_LABEL) → SonarQube analysis → quality gate → Cleanup. Nothing is deployed from
// here, the macropad runs on the desktop it drives.

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

properties([disableConcurrentBuilds()])

node {
  try {
    env.CI = 'true'

    stage('Checkout') {
        deleteDir()                      // clean workspace
        checkout scm
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
            sh "${scannerHome}/bin/sonar-scanner ${keyArg}"
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

    stage('Cleanup') {
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

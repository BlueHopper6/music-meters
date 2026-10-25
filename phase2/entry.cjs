// A packaged Electron executable starts its configured main regardless of
// command-line app paths. The editor's export child passes PHASE2_JOB, so route
// it to the same export main used during development.
if (process.env.PHASE2_JOB) require('./export-app/main.cjs')
else require('./editor-app/main.cjs')

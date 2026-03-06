const npmRun = require('npm-run');

npmRun.exec('npm run kiosk', (err, stdout, stderr) => {
    console.log('stdout', stdout);
    console.log('stderr', stderr);
    console.log('err', err);
});
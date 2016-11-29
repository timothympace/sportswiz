var requirejs = require('requirejs');

requirejs.config({
    //Use node's special variable __dirname to
    //get the directory containing this file.
    //Useful if building a library that will
    //be used in node but does not require the
    //use of node outside
    baseUrl: __dirname,

    //Pass the top-level main.js/index.js require
    //function to requirejs so that node modules
    //are loaded relative to the top-level JS file.
    nodeRequire: require,
    
    paths : {
        'routes' : 'routes'
    }
});

requirejs([
    'express',
    'http',
    'routes/MainRoutes',
    'fs'
],
function(
    express,
    http,
    MainRoutes,
    fs
) { "use strict";

    // server options
    var port        = 8080;

    // create app
    var app = express();

    // Register all the URLs this server will respond to.
    app.use(MainRoutes);

	http.createServer(app).listen(port, function(){
		console.log('HTTP Listening on port: %s ...', port);
	});
    
});

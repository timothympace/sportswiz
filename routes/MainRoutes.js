define(['express',
        'routes/wizapi'],
function(express, wizapi) {

    var MainRoutes = express.Router();
    
    // Logging mechanism
    MainRoutes.use(function (request, response, next) {
        console.info('%s - %s://%s%s', request.method, request.protocol,
            request.get('host'), request.originalUrl);
        return next();
    });
    
    // Add headers
    MainRoutes.use(function (req, res, next) {

        // Website you wish to allow to connect
        res.setHeader('Access-Control-Allow-Origin', 'http://tmpace.com');

        // Request methods you wish to allow
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');

        // Request headers you wish to allow
        res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');

        // Set to true if you need the website to include cookies in the requests sent
        // to the API (e.g. in case you use sessions)
        res.setHeader('Access-Control-Allow-Credentials', true);

        // Pass to next layer of middleware
        return next();
    });
    
    MainRoutes.use('/api', wizapi);
    
    return MainRoutes;
});

define([
    'express',
    'request',
    'jsdom',
    'fs',
    'child_process'
],
function(
    express,
    request,
    jsdom,
    fs,
    child_process
) {


    var wizapi = express.Router();

    var USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/48.0.2564.116 Safari/537.36'
    
    var channelTimeouts = {};
    
    function SWFObject(swf) {

        var vars = {};

        this.addParam = function() {

        };

        this.addVariable = function(key, value) {
            vars[key] = value;
        };

        this.get = function(key) {
            return vars[key];
        };

        this.getSwf = function() {
            return swf;
        };
    }
    
    function getLogo(sport) {
        switch (sport) {
            case 'MLB' :
                return 'mlb.png';
            case 'NFL' :
                return 'nfl.png';
            default:
                return '';
        }
    }
    
    function getRtmpdumpPid(channel) {
        var command = 'pgrep -f "^rtmpdump -r rtmp://localhost:1935/wiz/' + channel + ' -v -o /dev/null$"';
        var pgrep;
        try {
            pgrep = child_process.execSync(command);
        }
        catch (e) {
            pgrep = null;
        }
        return pgrep;
    }
    
    function isChannelRunning(channel) {
        var pid = getRtmpdumpPid(channel);
        return pid !== null;
    }
    
    function startChannel(channel) {
        var command = 'rtmpdump -r rtmp://localhost:1935/wiz/' + channel +' -v -o /dev/null';
        child_process.exec(command);
    }
    
    function stopChannel(channel) {
        var pid = getRtmpdumpPid(channel);
        process.kill(pid, 'SIGHUP');
    }
    
    function existsSync(filePath){
        try {
            fs.statSync(filePath);
        }
        catch (err) {
            if (err.code == 'ENOENT') {
                return false;
            }
        }
        return true;
    };
    
    function pollForFile(file, success, error, tryNum) {
        tryNum =  tryNum || 1;
        
        if (tryNum === 15) {
            error();
        }
        
        setTimeout(function() {
            if (existsSync(file)) {
                success();
            }
            else {
                pollForFile(file, success, error, ++tryNum);
            }
        }, 1000);
    }
    
    wizapi.get('/hls/:file', function(req, res) {
        var filename = req.params.file;
        var filePath = '/tmp/wizhls/' + filename;
        var channel = filename.split('.')[0];
        
        var id = channelTimeouts[channel];
        clearTimeout(id);
        channelTimeouts[channel] = setTimeout(function() {
            stopChannel(channel);
        }, 120000);
        
        if (filename.endsWith('.m3u8')) {
            if (!isChannelRunning(channel)) {
                startChannel(channel);
            }
            
            pollForFile(filePath, function() {
                res.setHeader('content-type', 'application/vnd.apple.mpegurl');
                res.sendfile(filePath);
            }, function() {
                res.status(404).send('HLS Stream could not be started.');
            });
        }
        else if (filename.endsWith('.ts')) {
            res.setHeader('content-type', 'video/mp2t');
            res.sendfile(filePath);
        }
        else {
            res.status(404).send('ERROR! HLS API must be a .m3u8 or a .ts file');
        }
    });
    
    wizapi.get('/channels', function(req, res) {
        request({
            uri: 'http://www.wiz1.net/lag10_home.php',
            headers : {
                'User-Agent' : USER_AGENT,
                'Referer' : 'http://www.wiz1.net/schedule'
            },
            method: "GET",
            timeout: 10000,
            followRedirect: false
        }, function(error, response, body) {
            var document = jsdom.jsdom(body);
            var links = document.getElementsByTagName('a')
            links = Array.prototype.slice.call(links, 0);
            links = links.filter(function(link) {
                try {
                    return link.href.indexOf('wiz1.net') !== -1 &&
                        link.previousSibling.nodeName === '#text' &&
                        link.previousSibling.previousSibling.nodeName === 'FONT' &&
                        link.previousSibling.previousSibling.previousSibling.nodeName === '#text';
                }
                catch(e) {
                    return false;
                }
            }).map(function(link) {
                // Calculate time in the current timezone
                var date = new Date();
                var time = link.previousSibling.previousSibling.previousSibling.textContent.trim();
                var hour = time.split(':')[0];
                var minutes = time.split(':')[1];
                hour = parseInt(hour);
                minutes = parseInt(minutes);
                var tzDiff = (date.getTimezoneOffset() + 1*60)/60;
                hour = hour - tzDiff;
                if (hour < 0) hour = hour + 24;
                date.setHours(hour);
                date.setMinutes(minutes);
                //TODO set date
                
                var ch = link.href.match(/channel(\d+)/)[1];
                var title = link.previousSibling.textContent.trim();
                title = title.replace(/[\u0080-\uFFFF]/g, '');
                return {
                   time : date.getTime(),
                   sport : link.previousSibling.previousSibling.childNodes[0].textContent,
                   title : title,
                   channel : ch,
                   rtmp : 'rtmp://tmpace.com:1935/wiz/' + ch,
                   hls : 'http://tmpace.com:8080/wizapi/hls/' + ch + '.m3u8'
                };
            });
            res.send(links);
        });
    });

    wizapi.get('/channels/:ch', function(req, res) {
        var ch = req.params.ch

        var chUrl = 'http://www.wiz1.net/ch' + ch;
        var chReferer = 'http://www.wiz1.net/channel' + ch;

        request({
            uri: chUrl,
            headers : {
                'User-Agent' : USER_AGENT,
                'Referer' : chReferer
            },
            method: "GET",
            timeout: 10000,
            followRedirect: false
        }, function(error, response, body) {
            var re = /<script.*?swidth.*?sheight.*?>.*?<script.*?src="(.*?)".*?<\/script>/;
            embedUrl = re.exec(body)[1];
            request({
                uri : embedUrl,
                headers : {
                    'User-Agent' : USER_AGENT
                },
                method: "GET",
                timeout: 10000,
                followRedirect: false
            }, function(error, response, body) {
                var swidth = 640;
                var sheight = 480;
                var document = jsdom.jsdom('');

                var _write = document.write.bind(document);
                var newBody = '';
                document.write = function() {
                    var args = Array.prototype.slice.call(arguments);
                    var newWrite = args.join('');
                    newBody += newWrite;
                };

                try {
                    eval(body);
                }
                catch (e) {
                    console.log(e);
                }
                
                if (/^<script>[\s\S]*<\/script>$/.test(newBody)) {
                    var stuff = newBody.match(/^<script>([\s\S]*)<\/script>$/)[1];
                    try {
                        eval(stuff);
                    }
                    catch (e) {
                        console.log(e);
                    }
                }
                
                _write(newBody);

                var frame = document.getElementsByTagName('iframe')[0];
                var src = "'" + frame.src + "'";
                var pageUrl = eval(src);
                request({
                    uri : pageUrl,
                    headers : {
                        'User-Agent' : USER_AGENT
                    },
                    method: "GET",
                    timeout: 10000,
                    followRedirect: false
                }, function(error, response, body) {
                    var re = />([^<]*SWFObject[^<]*)</;
                    swfCode = re.exec(body)[1];
                    try {
                        eval(swfCode);
                    }
                    catch (e) {

                    }
                    var rtmpUrl = so.get('streamer');
                    var playPath = so.get('file');
                    var swfUrl = so.getSwf();

                    var stream = rtmpUrl + " playpath=" + playPath + " pageUrl=" + pageUrl + " swfUrl=" + swfUrl;
                    res.send(stream);
                });
            });

        });

    });
    
    wizapi.get('/channels/:ch/start', function(req, res) {
        
        var channel = req.params.ch;
        
        if (isChannelRunning(channel)) {
            res.status(409).send('The channel is already running');
            return;
        }
        
        startChannel(channel);
        
        res.status(200).send("OK");
    });
    
    wizapi.get('/channels/:ch/stop', function(req, res) {
        
        var channel = req.params.ch;
        
        if (!isChannelRunning(channel)) {
            res.status(409).send('The channel is not running');
            return;
        }
        
        stopChannel(channel);
        
        res.status(200).send("OK");
    });
    
    wizapi.get('/plex/playlist', function(req, res) {
        request({
            uri: 'http://localhost:8080/wizapi/channels',
            method: "GET",
            timeout: 10000,
            followRedirect: false
        }, function(error, response, body) {
            var channelData = JSON.parse(body);
            playlist = '#EXTM3U\n';
            for (var i = 0; i < channelData.length; i++) {
                playlist += '#EXTINF:0';
                playlist += ' ';
                playlist += 'tvg-id="' + channelData[i].title + '"';
                playlist += ' ';
                playlist += 'tvg-logo="' + getLogo(channelData[i].sport) + '"';
                playlist += ' ';
                playlist += 'tvg-name="' + channelData[i].title + '"';
                playlist += ' ';
                playlist += 'group-title="' + channelData[i].sport + '"';
                playlist += ' ';
                playlist += 'hls="' + channelData[i].hls + '"';
                playlist += ',';
                playlist += channelData[i].title;
                playlist += '\n';
                playlist += channelData[i].rtmp;
                playlist += '\n\n';
            }
            res.send(playlist);
        });
    });

    wizapi.get('/plex/xmltv', function(req, res) {
        request({
            uri: 'http://localhost:8080/wizapi/channels',
            method: "GET",
            timeout: 10000,
            followRedirect: false
        }, function(error, response, body) {
            var channelData = JSON.parse(body);
            var xml = '<?xml version="1.0" encoding="UTF-8"?>';
            xml += '<tv>';
            for (var i = 0; i < channelData.length; i++) {
                var title = channelData[i].title.replace('&', '&amp;');
                var time = new Date(channelData[i].time);
                var timeString = time.getUTCFullYear() + ("0" + (time.getUTCMonth() + 1)).slice(-2) + ("0" + time.getUTCDate()).slice(-2) + ("0" + time.getUTCHours()).slice(-2) +
                    ("0" + time.getUTCMinutes()).slice(-2) + "00";
                xml += '<programme start="' + timeString + ' +0000" stop="' + timeString + ' +0000" channel="' + title + '">';
                xml += '<title>' + title + '</title>';
                xml += '<desc>Just a dummy programme desctription</desc>';
                xml += '</programme>';
            }
            xml += '</tv>';
            res.send(xml);
        });
    });

    return wizapi;
});

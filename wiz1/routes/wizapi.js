define([
    'express',
    'request',
    'jsdom',
    'fs',
    'child_process',
    'escape-string-regexp'
],
function(
    express,
    request,
    jsdom,
    fs,
    child_process,
    regexEscape
) {

    var wizapi = express.Router();
    
    var HLS_DIR = '/tmp/wizhls';
    
    var channelTimeouts = {};
    
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
    
    function pollForFile(file) {
        return new Promise(function(resolve, reject) {
            var timeout;
            
            function poll() {
                if (existsSync(file)) {
                    // If the file exists, clear the master timeout.
                    clearTimeout(timeout);
                    resolve();
                    return true;
                }
                else {
                    // Schedule a re-poll for 100 ms later.
                    setTimeout(poll, 100);
                    return false;
                }
            };
            
            // If the first poll is unsuccessful, set a master timeout
            // of 30 seconds to reject the promise.
            if (!poll()) {
                timeout = setTimeout(reject, 30000); 
            }
        });
    }
    
    function startHLS(ch) {
        return new Promise(function(resolve, reject) {
            
            // Timeout the channel
            var id = channelTimeouts[ch];
            clearTimeout(id);
            channelTimeouts[ch] = setTimeout(function() {
                stopChannel(ch);
            }, 120000);
            
            // If the channel is not yet running, start the channel
            // and wait for the m3u8 file to appear.
            if (!isChannelRunning(ch)) {
                startChannel(ch);
            }

            pollForFile(`${HLS_DIR}/${ch}.m3u8`).then(resolve, reject);
        });
    }

    var forceBufferedWritesInScript = (function () {
        
        function makeBufferedWriteMethod() {
    
            var buffer = [];
            var timer;
            
            return function bufferedWrite() {
                var args = Array.prototype.slice.call(arguments).map(function(text) {
                    return text.replace(/document\.write/g, 'bufferedWrite');
                });
                buffer = buffer.concat(args);
                clearTimeout(timer);
                setTimeout(function() {
                    document.write(buffer.join(''));
                    buffer = [];
                }, 10);
            }
        }
        
        return function replaceDocumentWrites(body) {
            body = body.replace(/document\.write/g, 'bufferedWrite');
            body = makeBufferedWriteMethod.toString() + ';' +
                'var bufferedWrite = makeBufferedWriteMethod();' + body;
            return body;
        };
    })();

    function getChannels() {
        return new Promise(function(resolve, reject) {
            jsdom.env({
                url : 'http://www.wiz1.net/lag10_home.php',
                referer : 'http://www.wiz1.net/schedule',
                done : function(error, window) {
                    if (error) return reject(error);
                    
                    var document = window.document;
                    var allTimesAre = document.querySelector('body h4');
                    var match = /All times CET \(GMT (\d+)([+-])\)/.exec(allTimesAre.textContent);
                    var offset = match[1];
                    var sign = match[2];
                    var utcDiff = sign === '+' ? offset*1 : offset*-1;
                    var tzDiff = ((new Date()).getTimezoneOffset() + utcDiff*60)/60;
                    

                    var channels = [];
                    var links = Array.prototype.slice.call(document.getElementsByTagName('a'));
                    links.forEach(function(link) {
                        try {
                            var ch = link;
                            var title = ch.previousSibling;
                            var sport = title.previousSibling;
                            var time = sport.previousSibling;

                            ch = ch.href.match(/channel(\d+)/)[1];
                            title = title.textContent.trim().replace(/[\u0080-\uFFFF]/g, '');
                            sport = sport.childNodes[0].textContent;
                            time = time.textContent.trim();
                            
                            // Compute listed time as UTC timestamp
                            var date = new Date();
                            var hour = parseInt(time.split(':')[0]);
                            var minute = parseInt(time.split(':')[1]);
                            var utcHour = hour - tzDiff;
                            if (utcHour < 0) utcHour = utcHour + 24;
                            date.setHours(utcHour);
                            date.setMinutes(minute);
                            date.setSeconds(0);
                            var utc = date.getTime();
                            
                            var channel = {
                                time : utc,
                                sport : sport,
                                title : title,
                                channel : ch,
                                rtmp : 'rtmp://tmpace.com:1935/wiz/' + ch,
                                hls : 'http://tmpace.com:8080/wizapi/hls/' + ch + '.m3u8'
                            };
                            
                            channels.push(channel);
                        }
                        catch (e) {}
                    });

                    resolve(channels);
                }
            });
        });
    }
 
    function getChannel(ch) {
        var chUrl = 'http://www.wiz1.net/channel' + ch;

        var swfRegex = new RegExp('swfobject\.js');
        var lagRegex = new RegExp('/embed/lag');
        var requiredFiles = ['/ch' + ch, '/embed/lag', '/embed/watch', 'swfobject.js', 'stata.html'];
        var skipRegex = new RegExp(
            requiredFiles.map(function(file) {
                return '(?=^(?!.*' + regexEscape(file) + '))';
            }).join('')
        );
        
        return new Promise(function(resolve, reject) {
            jsdom.env({
                url : chUrl,
                created : new Function(),
                resourceLoader : function (resource, callback) {
                    try {
                        if (swfRegex.test(resource.url.pathname)) {
                            return resource.defaultFetch(function (err, body) {
                                if (err) return callback(err);
                                
                                // Allow the SWFObject script to execute.
                                callback(null, body);

                                // Get window object from element (iframe) and use
                                // it to find a variable that is an instanceof SWFObject.
                                var window = resource.element.ownerDocument.defaultView;
                                var so = window[Object.keys(window).find(function(value) {
                                    return window[value] instanceof window.SWFObject;
                                })];

                                // Use the SWFObject and window (iframe) location
                                // to determine RTMP values for channel.
                                resolve({
                                    rtmpUrl : so.getVariable('streamer'),
                                    playPath : so.getVariable('file'),
                                    pageUrl : window.location.href,
                                    swfUrl : so.getAttribute('swf')
                                });
                            });
                        }
                        else if (lagRegex.test(resource.url.pathname)) {
                            return resource.defaultFetch(function (err, body) {
                                if (err) return callback(err);
                                body = forceBufferedWritesInScript(body);
                                callback(null, body);
                            });
                        }
                        else {
                            return resource.defaultFetch(callback);
                        }
                    }
                    catch (e) {
                        reject(e);
                    }
                },
                features: {
                    FetchExternalResources: ["script", "iframe"],
                    ProcessExternalResources: ["script"],
                    SkipExternalResources: skipRegex
                }
            });
        });
    }

    function getPlaylist() {
        return getChannels().then(function(channels) {
            playlist = '#EXTM3U\n';
            for (var i = 0; i < channels.length; i++) {
                var title = channels[i].title;
                var sport = channels[i].sport;
                var logo = getLogo(sport);
                var hls = channels[i].hls;
                playlist += `#EXTINF:0 tvg-id="${title}" tvg-logo="${logo}" `;
                playlist += `tvg-name="${title}" group-title="${sport}",`;
                playlist += `${title}\n${hls}\n\n`;
            }
            return playlist;
        });
    }
    
    function getXMLTVGuide() {
        return getChannels().then(function(channels) {
            var xml = '<?xml version="1.0" encoding="UTF-8"?><tv>';
            for (var i = 0; i < channels.length; ++i) {
                var title = channels[i].title.replace('&', '&amp;');
                var time = dateToXMLTVTimeString(new Date(channels[i].time));
                var desc = 'Just a dummy programme desctription';
                xml += `<programme start="${time}" stop="${time}" channel="${title}">`;
                xml += `<title>${title}</title><desc>${desc}</desc></programme>`;
            }
            xml += '</tv>';
            return xml;
        });
    }
    
    function dateToXMLTVTimeString(date) {
        var year = date.getUTCFullYear();
        var month = ('0' + (date.getUTCMonth() + 1)).slice(-2);
        var day = ('0' + date.getUTCDate()).slice(-2);
        var hours = ('0' + date.getUTCHours()).slice(-2);
        var minutes = ('0' + date.getUTCMinutes()).slice(-2);
        var seconds = ('0' + date.getUTCSeconds()).slice(-2);
        
        return year + month + day + hours + minutes + seconds + ' +0000'
    }

    function getChannelCommand(channel) {
        return 'rtmpdump -r rtmp://localhost:1935/wiz/' + channel +' -v -o /dev/null';
    }
    
    function startChannel(channel) {
        var command = getChannelCommand(channel);
        child_process.exec(command);
    }
    
    function stopChannel(channel) {
        var pid = getChannelPid(channel);
        process.kill(pid, 'SIGHUP');
        // TODO remove HLS files
    }
    
    function isChannelRunning(channel) {
        var pid = getChannelPid(channel);
        return pid !== null;
    }
    
    function getChannelPid(channel) {
        var command = `pgrep -f "^${getChannelCommand(channel)}\$"`;
        var pgrep;
        try {
            pgrep = child_process.execSync(command);
        }
        catch (e) {
            pgrep = null;
        }
        return pgrep;
    }
    
    wizapi.get('/channels', function(req, res) {
        getChannels()
        .then(function(links) {
            res.status(200).send(links);
        })
        .catch(function(error) {
            res.status(404).send('Could not get schedule. ' + error);
        });
    });
 
    wizapi.get('/channels/:ch', function(req, res) {
        var ch = req.params.ch
        getChannel(ch)
        .then(function(value) {
            res.status(200).send(value);
        })
        .catch(function(error) {
            res.status(404).send('Channel not found. ' + error);
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
        getPlaylist()
        .then(function(playlist) {
            res.status(200).send(playlist);
        })
        .catch(function(error) {
            res.status(404).send('Could not get playlist. ' + error);
        });
    });

    wizapi.get('/plex/xmltv', function(req, res) {
        getXMLTVGuide()
        .then(function(tvg) {
            res.status(200).send(tvg);
        })
        .catch(function(error) {
            res.status(404).send('Could not get xmltv guide. ' + error);
        });
    });
    
    wizapi.get('/hls/:ch.m3u8', function(req, res) {
        var ch = req.params.ch;
        var file = `${HLS_DIR}/${ch}.m3u8`;
        
        startHLS(ch).then(function() {
            res.setHeader('content-type', 'application/vnd.apple.mpegurl');
            res.sendFile(file);
        })
        .catch(function(error) {
            res.status(404).send('HLS Channel not found. ' + error);
        });
    });
    
    wizapi.get('/hls/:segment.ts', function(req, res) {
        var segment = req.params.segment;
        var file = `${HLS_DIR}/${segment}.ts`;
        
        pollForFile(file).then(function() {
            res.setHeader('content-type', 'video/mp2t');
            res.sendFile(file);
        })
        .catch(function(error) {
            res.status(404).send('Segment not found. ' + error);
        });
    });
    
    wizapi.get('/channels/:ch/rtmp', function(req, res) {
        var ch = req.params.ch
        getChannel(ch)
        .then(function(channel) {
            res.status(200).send(`${channel.rtmpUrl} playpath=${channel.playPath} pageURL=${channel.pageUrl} swfUrl=${channel.swfUrl}`);
        })
        .catch(function(error) {
            res.status(404).send('Channel not found. ' + error);
        });
    });

    return wizapi;
});

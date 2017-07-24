define([
    'express',
    'request',
    'jsdom',
    'fs',
    'child_process',
    'escape-string-regexp',
    'imagemagick'
],
function(
    express,
    request,
    jsdom,
    fs,
    child_process,
    regexEscape,
    imagemagick
) {

    var wizapi = express.Router();

    var HLS_DIR = '/usr/src/app/hls';

    var channelTimeouts = {};

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
                timer = setTimeout(function() {
                    var docWrite = buffer.join('');
                    buffer = [];
                    document.write(docWrite);
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

    function getChannels(host) {
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
                                rtmp : 'rtmp://' + host + ':1935/wiz/' + ch,
                                hls : 'http://' + host + '/sportswiz/api/hls/' + ch + '.m3u8'
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
        // If ch is an integer, prefix it with 'channel'.
        // If ch is not an integer, it is a special channel
        // like nfl, espn, nba, or golf.
        var chName = isNaN(ch) ?  ch : 'channel' + ch;
        var chUrl = 'http://www.wiz1.net' + '/' + chName;

        // Define regular expressions that identify
        // important scripts in the loading process
        // of a wiz1 stream.
        var embedRegex = new RegExp('/embed(?:hc)?/(?!watch)');
        var watchRegex = new RegExp('/embed/watch');
        var swfRegex = new RegExp('swfobject(?:2)?\.js');
        var embjsRegex = new RegExp('emb\.js');

        var requiredFiles = [chName, 'ch' + ch, '/embed', '/watch', 'swfobject'];
        var skipRegex = new RegExp(
            requiredFiles.map(function(file) {
                return '(?=^(?!.*' + regexEscape(file) + '))';
            }).join('')
        );



        return new Promise(function(resolve, reject) {
            jsdom.env({
                url : chUrl,
                virtualConsole: jsdom.createVirtualConsole().sendTo(console),
                created : new Function(),
                resourceLoader : function (resource, callback) {
                    try {
                        return resource.defaultFetch(function (err, response) {
                            // If there was an error retrieving the resource
                            // err will be an error and response will be null.
                            if (err) return callback(err);

                            // Test to see if this is the embed script.
                            // This script uses document.write in a way
                            // that jsdom cannot handle. In order to keep
                            // things running smoothly, we have to alter the
                            // script to use document.write with a buffer.
                            if (embedRegex.test(resource.url.pathname)) {
                                response = forceBufferedWritesInScript(response);
                            }

                            // Allow the resource response to be handled by jsdom.
                            callback(null, response);

                            // Check to see if the resource we just downloaded
                            // is one of the ones that contains information
                            // on the RTMP stream variables.
                            if (watchRegex.test(resource.url.pathname)) {
                                // Get the window object inside the iframe content.
                                // resource.element refers to the iframe in this case.
                                var window = resource.element.contentWindow;

                                // The RTMP stream pageUrl is the location of
                                // this iframe.
                                var pageUrl = window.location.href;

                                // Inside the iframes document, there will be a
                                // <span> that contains the SWF parameters.
                                // There is an html param tag for the movie, and
                                // the flash stream variables. Use these to extract
                                // the keys and values for the RTMP stream.
                                var swfUrl = window.document
                                    .querySelector('#splay param[name="movie"]')
                                    .getAttribute('value');
                                var flashvars = window.document
                                    .querySelector('#splay param[name="flashvars"]')
                                    .getAttribute('value');

                                // Match the flashvars for the rtmpUrl and playpath.
                                var rtmpUrl = flashvars.match(/streamer=([^&]+)/)[1];
                                var playPath = flashvars.match(/file=([^&]+)/)[1];

                                // Resolve the promise with the RTMP stream values.
                                resolve({rtmpUrl, playPath, pageUrl, swfUrl});
                            }
                            else if (swfRegex.test(resource.url.pathname) || embjsRegex.test(resource.url.pathname)) {
                                // In this case, the window is retrieved from the element
                                // that requested the SWFObject script. This window object
                                // is used to observe the flash player.
                                var window = resource.element.ownerDocument.defaultView;

                                // Get shockwave object from the window.
                                var so = window[Object.getOwnPropertyNames(window).find(function(prop) {
                                    return prop instanceof window.SWFObject;
                                })];

                                // Use the sfwParam, flashvarsParam, and window (iframe) location
                                // to determine RTMP values for channel.
                                var rtmpUrl = so.getVariable('streamer');
                                var playPath = so.getVariable('file');
                                var pageUrl = window.location.href;
                                var swfUrl = so.getAttribute('swf');

                                if (rtmpUrl && playPath && pageUrl && swfUrl) {
                                    resolve({rtmpUrl, playPath, pageUrl, swfUrl});
                                }
                            }
                        });
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

    function getPlaylist(host) {
        return getChannels(host).then(function(channels) {
            playlist = '#EXTM3U\n';
            for (var i = 0; i < channels.length; i++) {
                var title = channels[i].title;
                var sport = channels[i].sport;
                var hls = channels[i].hls;
                playlist += `#EXTINF:0 tvg-id="${title}" tvg-name="${title}" `
                playlist += `group-title="${sport}",${title}\n${hls}\n\n`;
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
        return 'rtmpdump -r rtmp://nginx:1935/wiz/' + channel +' -v -o /dev/null';
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

    function generateMatchupLogo(sport, teamA, teamB, width, height) {
        return new Promise(function(resolve, reject) {

            var cmd = `scripts/matchup/matchup.sh -s ${sport} -a ${teamA} -b ${teamB} ${width} ${height} png:-`

            child_process.exec(cmd, {
                encoding: 'binary',
                maxBuffer: 1024 * 1024
            }, function(err, stdout) {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(new Buffer(stdout, 'binary'));
                }
            });
        });
    }

    wizapi.get('/channels', function(req, res) {
        var host = req.headers.host;
        getChannels(host)
        .then(function(links) {
            res.status(200).send(links);
        })
        .catch(function(error) {
            res.status(404).send('Could not get schedule. ' + error);
        });
    });

    wizapi.get('/channels/:ch', function(req, res) {
        var ch = req.params.ch;
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
        var host = req.headers.host;
        getPlaylist(host)
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
        var ch = req.params.ch;
        getChannel(ch)
        .then(function(channel) {
            res.status(200).send(`${channel.rtmpUrl} playpath=${channel.playPath} pageURL=${channel.pageUrl} swfUrl=${channel.swfUrl}`);
        })
        .catch(function(error) {
            res.status(404).send('Channel not found. ' + error);
        });
    });

    wizapi.get('/images/:sport/:team1-at-:team2.png', function(req, res) {
        var sport = req.params.sport;
        var team1 = req.params.team1;
        var team2 = req.params.team2;
        var width = req.query.width || "360";
        var height = req.query.height || "240";

        generateMatchupLogo(sport, team1, team2, width, height)
        .then(function(image) {
            res.setHeader('content-type', 'image/png');
            res.status(200).send(image);
        })
        .catch(function(error) {
            res.status(404).send('Logo not found. ' + error);
        });
    });

    return wizapi;
});

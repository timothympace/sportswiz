#!/bin/bash

exec ffmpeg -i "`curl http://localhost/sportswiz/api/channels/$2/rtmp`" -c copy -f flv rtmp://localhost:1935/$1/$2;

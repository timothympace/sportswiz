#!/bin/bash

exec ffmpeg -i "`curl http://node:8080/wizapi/channels/$2/rtmp`" -c copy -f flv rtmp://localhost:1935/$1/$2;

#!/bin/bash

exec ffmpeg -i "`curl http://localhost:8080/wizapi/channels/$2`" -c copy -f flv rtmp://localhost:1935/$1/$2;

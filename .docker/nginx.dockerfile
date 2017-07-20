FROM ubuntu

MAINTAINER Timothy Pace

EXPOSE 80
EXPOSE 1935

ENV PATH $PATH:/usr/local/nginx/sbin

ARG NGINX_VER=1.13.2
ARG RTMP_VER=1.1.11
ARG DEBIAN_FRONTEND=noninteractive

# Create a src directory for pulling and compiling nginx.
RUN mkdir /src

# Update repo & install necessary tools for building/running nginx.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    ffmpeg \
    libpcre3-dev \
    libssl-dev \
    software-properties-common \
    wget

# Get the source for nginx.
WORKDIR /src
RUN wget http://nginx.org/download/nginx-${NGINX_VER}.tar.gz && \
    tar xzf nginx-${NGINX_VER}.tar.gz && \
    rm nginx-${NGINX_VER}.tar.gz
# Get the source for nginx rtmp module.
RUN wget https://github.com/arut/nginx-rtmp-module/archive/v${RTMP_VER}.tar.gz && \
    tar xzf v${RTMP_VER}.tar.gz && \
    rm v${RTMP_VER}.tar.gz

# Compile nginx
WORKDIR /src/nginx-${NGINX_VER}
RUN ./configure --with-http_ssl_module \
    --conf-path=/etc/nginx/nginx.conf \
    --error-log-path=/var/log/nginx/error.log \
    --http-log-path=/var/log/nginx/access.log \
    --add-module=/src/nginx-rtmp-module-${RTMP_VER} \
    --with-debug && \
    make && \
    make install

# Forward logs to Docker
RUN ln -sf /dev/stdout /var/log/nginx/access.log && \
    ln -sf /dev/stderr /var/log/nginx/error.log

ADD nginx/nginx.conf /etc/nginx/nginx.conf
ADD nginx/startFfmpeg.sh /
RUN chmod +x /startFfmpeg.sh
RUN mkdir -p /var/www/

CMD "nginx"

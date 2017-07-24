$.ajax({
   url : '/sportswiz/api/channels',
   dataType : 'json',
   success : function(response) {
       var table = $('table#channels tbody');
       var channels = response;
       channels.forEach(function(channel) {
           var tr = $('<tr>');

           var time = new Date(channel.time);
           time = time.toLocaleString('en-US', {
               hour: 'numeric',
               minute: 'numeric'
           });
           tr.append($('<td>').html(channel.channel));
           tr.append($('<td>').html(time));
           tr.append($('<td>').html(channel.sport));
           tr.append($('<td>').html(channel.title));
 
           var vlcLink = $('<a>');    
           var href = 'vlc-x-callback://x-callback-url/stream?url=' + channel.rtmp;
           vlcLink.attr('href', href);
           vlcLink.html('VLC iOS');
               
           var hlsLink = $('<a>');    
           hlsLink.attr('href', channel.hls);
           hlsLink.html('HLS');

           tr.append($('<td>').append(vlcLink));
           tr.append($('<td>').append(hlsLink));

           table.append(tr);
       });
   }
}); 

#!/bin/bash
# usage: reel.sh ID  -> out/ID.mp4 ; 6 frames, 3s each (logo 2.4s), gentle push-in, 0.5s crossfades
ID=$1; D=3; X=0.5
args=(); filt=""; n=$(ls out/$ID-*.png | wc -l)
for i in $(seq 1 $n); do
  d=$D; [ $i -eq $n ] && d=2.4
  args+=(-loop 1 -t $d -i out/$ID-$i.png)
  fr=$(python3 -c "print(int($d*30))")
  filt+="[$((i-1)):v]scale=1188:2112,zoompan=z='min(1+0.0009*on,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=$fr:s=1080x1920:fps=30,format=yuv420p,setsar=1[v$i];"
done
prev=v1; off=0
for i in $(seq 2 $n); do
  off=$(python3 -c "print(round($off+$D-$X,2))")
  filt+="[$prev][v$i]xfade=transition=fade:duration=$X:offset=$off[x$i];"; prev=x$i
done
ffmpeg -y -loglevel error "${args[@]}" -f lavfi -t 14.9 -i anullsrc=r=44100:cl=stereo -filter_complex "${filt%;}" -map "[$prev]" -map $n:a -t 14.9 -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 64k -movflags +faststart out/$ID.mp4
ffprobe -v error -show_entries format=duration,size -of csv=p=0 out/$ID.mp4

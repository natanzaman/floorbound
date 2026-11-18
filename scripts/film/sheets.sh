#!/bin/zsh
# Contact sheets of one take: sheets.sh <takedir> <view> <scene> [every_secs]
# Finds the scene's wall-time span in track.jsonl, maps it to video time (video ends ~wall secs after run), tiles frames.
T=$1; V=$2; SC=$3; EV=${4:-2}
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 $T/$V.webm)
wall=$(grep 'wall secs' $T/rec.out | awk '{print $3}')
read a b <<< $(python3 -c "
import json
ts=[json.loads(l) for l in open('$T/track.jsonl')]
s=[r['t'] for r in ts if r.get('scene')=='$SC']
print(min(s), max(s))")
off=$(python3 -c "print($dur-$wall)")
st=$(python3 -c "print(max(0,$a+$off))"); len=$(python3 -c "print($b-$a)")
n=$(python3 -c "import math; print(math.ceil($len/$EV))")
cols=4; rows=$(( (n + cols - 1) / cols ))
ffmpeg -v error -y -ss $st -t $len -i $T/$V.webm -vf "fps=1/$EV,scale=400:-1,drawtext=text='%{pts\\:hms}':x=5:y=5:fontcolor=yellow:fontsize=18,tile=${cols}x${rows}" -frames:v 1 $T/sheet-$V-$SC.png
echo "$T/sheet-$V-$SC.png  scene $SC wall $a..$b video $st +$len"

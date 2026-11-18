#!/bin/zsh
# Contact sheets of one take: sheets.sh <takedir> <view> <scene> [every_secs]
# Finds the scene's wall-time span in track.jsonl, maps it to video time with timing.json (run start vs first frame), tiles frames.
T=$1; V=$2; SC=$3; EV=${4:-2}
read a b <<< $(python3 -c "
import json
ts=[json.loads(l) for l in open('$T/track.jsonl')]
s=[r['t'] for r in ts if r.get('scene')=='$SC']
print(min(s), max(s))")
off=$(python3 -c "import json; t=json.load(open('$T/timing.json')); print((t['runStartMs']-t['views']['$V']['firstFrameMs'])/1000)")
st=$(python3 -c "print(max(0,$a+$off))"); len=$(python3 -c "print($b-$a)")
n=$(python3 -c "import math; print(math.ceil($len/$EV))")
cols=4; rows=$(( (n + cols - 1) / cols ))
ffmpeg -v error -y -ss $st -t $len -i $T/$V.mp4 -vf "fps=1/$EV,scale=400:-1,drawtext=text='%{pts\\:hms}':x=5:y=5:fontcolor=yellow:fontsize=18,tile=${cols}x${rows}" -frames:v 1 $T/sheet-$V-$SC.png
echo "$T/sheet-$V-$SC.png  scene $SC wall $a..$b video $st +$len"

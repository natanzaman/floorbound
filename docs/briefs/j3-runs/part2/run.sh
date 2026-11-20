#!/bin/bash
# usage: run.sh <dir> <tag> <portbase>
D=$1; T=$2; B=$3; O=$(dirname $0)
cd $D
( ROLES=guardian,ranger,cleric BOT_SKILL=5 RUNS=2 STATS=1 OPEN_STATS=1 PORT=$((B+0)) node test/wardenskill.js > $O/$T-warden3.txt 2>&1 ) &
( ROLES=guardian,swordsman,berserker,ranger,bard,cleric BOT_SKILL=5 RUNS=2 STATS=1 PORT=$((B+1)) node test/wardenskill.js > $O/$T-warden6.txt 2>&1 ) &
( BOSS=sovereign BOT_SKILL=5 RUNS=2 STATS=1 PORT=$((B+2)) node test/wardenskill.js > $O/$T-sov.txt 2>&1 ) &
( BOT_SKILL=5 RUNS=2 OPEN_STATS=1 LOG_FILE=$O/$T-f3server.log PORT=$((B+3)) node test/floor3boss.js > $O/$T-f3.txt 2>&1 ) &
wait
echo done > $O/$T-done

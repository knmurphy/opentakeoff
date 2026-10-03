#!/bin/zsh
D=<evidence dir>
until curl -s -o /dev/null http://localhost:5313/; do sleep 1; done
for i in 1 2; do
  for lab in base fix; do
    if [ $lab = base ]; then port=5313; wt=<base checkout>; else port=5312; wt=<fix checkout>; fi
    [ $lab = base ] && wt=<base checkout>
    echo "== $lab-ab$i $(date +%T) $(uptime | sed 's/.*load/load/')"
    node $D/measure-tile-leak.mjs --url http://localhost:$port/ --worktree $wt --label $lab-ab$i --scenario rapid,zoomed,rapidEarly --out $D/timing-ab 2>&1 | grep -E "done|Error|error:" 
  done
done
echo "== end $(date +%T) $(uptime | sed 's/.*load/load/')"

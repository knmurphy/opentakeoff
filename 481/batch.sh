#!/bin/zsh
# node read.mjs for every (build, page) pair; serve upstream/main on 5481 and this branch on 5482 (vite preview)
source ~/.nvm/nvm.sh >/dev/null; nvm use 24 >/dev/null
for pg in ink481 ink481-q75 demo2 demo2-q75; do
  for b in main:5481 branch:5482; do
    n=${b%%:*}; port=${b##*:}
    [[ -n "$SKIP_DONE" && -f out/$pg-$n-words.json ]] && continue
    node read.mjs $port $pg-$n $pg.pdf out | grep -E "state|stored"
  done
done

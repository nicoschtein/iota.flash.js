FROM node:9.3.0-onbuild
LABEL maintainer="j.innerbichler@gmail.com"

ENTRYPOINT ["node", "examples/flash.js"]
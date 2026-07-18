FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04
# FROM nvidia/cuda:12.0.1-cudnn8-runtime-ubuntu22.04

RUN apt-get update \
        && apt-get install -y python3-pip espeak gosu libsndfile1-dev emacs git \
        && apt-get clean \
        && rm -rf /var/lib/apt/lists/*

WORKDIR /
# `dummy` is regenerated with a fresh timestamp by `npm run build:docker:vcclient`
# before every build, which busts the layer cache below so this clone always
# pulls current code instead of a stale image layer.
ADD dummy /

RUN git clone https://github.com/NimuthuGanegoda/voice-changer.git -b master



RUN chmod 0777 /voice-changer/server
WORKDIR /voice-changer/server
RUN pip install numpy==2.2.6 \
        && pip install -r requirements.txt


ADD /setup.sh  /voice-changer/server
ADD /exec.sh  /voice-changer/server


ENTRYPOINT ["/bin/bash", "setup.sh"]

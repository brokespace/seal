FROM node:22.23.4-bookworm@sha256:2bd396628eceb5c999a6e43731fab69d5fb98b94ba9d9d90b5f64575c5178765 AS patched-node
FROM node:22-bookworm@sha256:5647be709086c696ff32edaaf1c70cd26d1da6ab2b39c32f3c7b4c4a31957e37

COPY --from=patched-node /usr/local/bin/node /usr/local/bin/node

# Why: immutable snapshot inputs keep the SSH/Git fixture identical across rebuild dates.
RUN sed -i \
      -e 's|http://deb.debian.org/debian-security|https://snapshot.debian.org/archive/debian-security/20260713T000000Z|' \
      -e 's|http://deb.debian.org/debian|https://snapshot.debian.org/archive/debian/20260713T000000Z|' \
      /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::Check-Valid-Until=false update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      git=1:2.39.5-0+deb12u3 \
      openssh-server=1:9.2p1-2+deb12u10 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /run/sshd /root/.ssh \
    && chmod 700 /root/.ssh

# uid 1000 is the node image's `node` user, so the SSH user is seal (1100).
# polkitd lets a user enable linger for itself; POLKIT= builds the host that refuses it.
# The systemd package bakes one machine-id into the image; it is removed so each container gets its own.
ARG POLKIT=polkitd=122-3
ARG SYSTEMD_VERSION=252.39-1~deb12u2
RUN apt-get -o Acquire::Check-Valid-Until=false update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      systemd=${SYSTEMD_VERSION} \
      systemd-sysv=${SYSTEMD_VERSION} \
      libpam-systemd=${SYSTEMD_VERSION} \
      dbus=1.14.10-1~deb12u1 \
      dbus-user-session=1.14.10-1~deb12u1 \
      ${POLKIT} \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 1100 --create-home --shell /bin/bash seal \
    && install -d -m 700 -o seal -g seal /home/seal/.ssh \
    && systemctl set-default multi-user.target \
    && systemctl enable ssh.service \
    && systemctl mask \
      console-getty.service getty.target systemd-firstboot.service \
      apt-daily.timer apt-daily-upgrade.timer dpkg-db-backup.timer \
      e2scrub_all.timer e2scrub_reap.service fstrim.timer \
    && rm -f /etc/machine-id /var/lib/dbus/machine-id

COPY fixture-init /usr/local/sbin/seal-fixture-init
RUN chmod 755 /usr/local/sbin/seal-fixture-init

# systemd reads this to know it runs in a container; SIGRTMIN+3 is its clean-shutdown signal.
ENV container=docker
STOPSIGNAL SIGRTMIN+3
EXPOSE 22
ENTRYPOINT ["/usr/local/sbin/seal-fixture-init"]

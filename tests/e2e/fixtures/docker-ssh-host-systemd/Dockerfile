# check=skip=InvalidDefaultArgInFrom
# The image of ../docker-ssh-host (patched node, apt snapshot sources, git, sshd). Its tag is a content hash, so there is no default.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}

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
ENTRYPOINT ["/usr/local/sbin/seal-fixture-init"]

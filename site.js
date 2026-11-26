const install = document.querySelector("[data-install]");

if (install) {
  const installDetails = install.querySelector("details");
  const installText = install.querySelector("[data-install-text]");
  const copyInstall = install.querySelector("[data-copy-install]");
  const installStatus = install.querySelector("[role='status']");

  copyInstall.hidden = false;
  copyInstall.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(installText.textContent.trim());
      installStatus.textContent = copyInstall.dataset.copied;
    } catch {
      installDetails.open = true;
      installText.focus({ preventScroll: true });
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(installText);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      installStatus.textContent = copyInstall.dataset.fallback;
    }
  });
}

const film = document.querySelector("[data-film]");
const video = film.querySelector("video");
const playButton = film.querySelector("[data-play]");
const filmStrip = film.querySelector(".film-strip");
const clock = film.querySelector("[data-clock]");
const shots = [...film.querySelectorAll("[data-shot]")];
const shotTimes = shots.map((shot) => Number(shot.dataset.shot));

if (video.canPlayType("video/mp4")) {
  let queuedStart;
  video.controls = false;
  playButton.hidden = false;
  filmStrip.hidden = false;

  const seekWhenReady = () => {
    if (queuedStart === undefined || !video.seekable.length) {
      return;
    }
    const end = video.seekable.end(video.seekable.length - 1);
    if (queuedStart <= end) {
      video.currentTime = queuedStart;
      queuedStart = undefined;
    }
  };

  const play = (start, focusPlayer) => {
    video.controls = true;
    playButton.hidden = true;
    queuedStart = start;
    seekWhenReady();
    if (focusPlayer) {
      video.focus({ preventScroll: true });
    }
    video.play().catch(() => {
      // Native controls let the visitor retry if playback is interrupted.
    });
  };

  playButton.addEventListener("click", () => play(undefined, true));
  shots.forEach((shot, index) => {
    shot.addEventListener("click", () => play(shotTimes[index], false));
  });

  const updatePlayback = () => {
    const time = video.currentTime;
    const seconds = Math.floor(time);
    const activeShot = shotTimes.findLastIndex((start) => start <= time);

    clock.textContent = "00:" + String(seconds).padStart(2, "0");
    shots.forEach((shot, index) => {
      shot.setAttribute("aria-current", String(index === activeShot));
    });
    if (Number.isFinite(video.duration) && video.duration > 0) {
      filmStrip.style.setProperty("--progress", String(time * 100 / video.duration) + "%");
    }
  };

  video.addEventListener("timeupdate", () => {
    seekWhenReady();
    updatePlayback();
  });
  video.addEventListener("loadedmetadata", seekWhenReady);
  video.addEventListener("canplay", seekWhenReady);
  video.addEventListener("progress", seekWhenReady);
}

const tour = document.querySelector("[data-tour]");
const tabList = tour.querySelector("[role='tablist']");
const tabs = [...tabList.querySelectorAll("[role='tab']")];
const panels = tabs.map((tab) => document.getElementById(tab.getAttribute("aria-controls")));

tabList.hidden = false;

const selectTab = (selected) => {
  tabs.forEach((tab, index) => {
    const active = index === selected;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    panels[index].hidden = !active;
  });
};

tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectTab(index));
  tab.addEventListener("keydown", (event) => {
    let next;
    switch (event.key) {
      case "ArrowLeft":
        next = (index - 1 + tabs.length) % tabs.length;
        break;
      case "ArrowRight":
        next = (index + 1) % tabs.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    selectTab(next);
    tabs[next].focus();
  });
});

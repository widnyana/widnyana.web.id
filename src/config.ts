import type { Site, SocialObjects } from "./types";

export const SITE: Site = {
  website: "https://astro-paper.pages.dev/", // replace this with your deployed domain
  author: "widnyana",
  desc: "A random dude in the Internet. Tinkering in Cloud Infrastructure, Computer Security, and Open-Source stuff.",
  title: "Widnyana",
  ogImage: "astropaper-og.jpg",
  lightAndDarkMode: true,
  postPerPage: 3,
  scheduledPostMargin: 15 * 60 * 1000, // 15 minutes
  mediumApiToken: process.env.MEDIUM_API_TOKEN,
};

export const LOCALE = {
  lang: "en", // html lang code. Set this empty and default will be "en"
  langTag: ["en-EN"], // BCP 47 Language Tags. Set this empty [] to use the environment default
} as const;

export const LOGO_IMAGE = {
  enable: false,
  svg: true,
  width: 216,
  height: 46,
};

export const SOCIALS: SocialObjects = [
  {
    name: "Github",
    href: "https://github.com/widnyana",
    linkTitle: ` ${SITE.title} on Github`,
    active: true,
  },
  {
    name: "GitLab",
    href: "https://gitlab.com/widnyana",
    linkTitle: `${SITE.title} on GitLab`,
    active: true,
  },
  {
    name: "LinkedIn",
    href: "https://linkedin.com/in/widnyana",
    linkTitle: `${SITE.title} on LinkedIn`,
    active: true,
  },
  {
    name: "Mail",
    href: "mailto:wid-at-widnyana.web.id",
    linkTitle: `Send an email to me`,
    active: true,
  },
  {
    name: "Twitter",
    href: "https://github.com/widnyana_",
    linkTitle: `${SITE.title} on Twitter`,
    active: true,
  },
  {
    name: "Telegram",
    href: "https://t.me/widnyana",
    linkTitle: `${SITE.title} on Telegram`,
    active: true,
  },
];

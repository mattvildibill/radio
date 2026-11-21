'use strict';

if (location.hostname.endsWith('.vercel.app')) {
  window.si ||= function () { (window.siq ||= []).push(arguments); };
  window.va ||= function () { (window.vaq ||= []).push(arguments); };

  for (const src of ['/_vercel/speed-insights/script.js', '/_vercel/insights/script.js']) {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    document.head.append(script);
  }
}

'use strict';

if (location.hostname.endsWith('.vercel.app')) {
  window.si ||= function () { (window.siq ||= []).push(arguments); };

  const script = document.createElement('script');
  script.src = '/_vercel/speed-insights/script.js';
  script.async = true;
  document.head.append(script);
}

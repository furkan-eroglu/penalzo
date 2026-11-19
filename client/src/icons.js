const seg = `<g id="s"><path d="M50 32V15" stroke="#111827" stroke-width="4" stroke-linecap="round"/><path d="M37 9.5 50 15l13-5.5A46 46 0 0 0 37 9.5Z" fill="#111827"/></g>`;
export const BALL = `<svg viewBox="0 0 100 100" aria-hidden="true"><defs>${seg}</defs><circle cx="50" cy="50" r="46" fill="#fff" stroke="#111827" stroke-width="4"/><polygon points="50,32 67.1,44.4 60.6,64.6 39.4,64.6 32.9,44.4" fill="#111827"/>${[0, 72, 144, 216, 288].map((a) => `<use href="#s" transform="rotate(${a} 50 50)"/>`).join('')}</svg>`;

export const GLOVE = `<svg viewBox="0 0 100 100" aria-hidden="true"><g fill="#fff" stroke="#111827" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"><path d="M27 54 13 41a7.5 7.5 0 0 1 11-10l12 11Z"/><rect x="27" y="15" width="13" height="42" rx="6.5"/><rect x="40.5" y="8" width="13" height="48" rx="6.5"/><rect x="54" y="11" width="13" height="46" rx="6.5"/><rect x="67.5" y="20" width="12" height="38" rx="6"/><path d="M27 46h52.5v18a20 20 0 0 1-20 20H47a20 20 0 0 1-20-20Z"/><rect x="36" y="80" width="35" height="13" rx="4" fill="#c8ff2e"/></g><path d="M40 62h27M40 70h27" stroke="#111827" stroke-width="3" stroke-linecap="round" opacity=".35"/></svg>`;

const i = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
export const ICON = {
  friends: i('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.2a5 5 0 0 1 4.5 5"/>'),
  back: i('<path d="M15 5l-7 7 7 7"/>'),
  eye: i('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: i('<path d="M3 3l18 18"/><path d="M10.6 5.1A10.7 10.7 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.5 6.6A17.300 17.300 0 0 0 2 12s3.600 7 10 7a10.300 10.300 0 0 0 4.300-.900"/><path d="M9.900 9.900a3 3 0 0 0 4.200 4.200"/>'),
  sound: i('<path d="M4 9.500v5h3.500L12 18.500v-13L7.500 9.500Z"/><path d="M15.500 9a4 4 0 0 1 0 6M18 6.500a7.500 7.500 0 0 1 0 11"/>'),
  mute: i('<path d="M4 9.500v5h3.500L12 18.500v-13L7.500 9.500Z"/><path d="M16 9.500l5 5M21 9.500l-5 5"/>'),
  logout: i('<path d="M10 4H5.500A1.500 1.500 0 0 0 4 5.500v13A1.500 1.500 0 0 0 5.500 20H10"/><path d="M15 8l4 4-4 4M19 12H9"/>'),
  close: i('<path d="M6 6l12 12M18 6 6 18"/>'),
  check: i('<path d="M5 12.500l4.500 4.500L19 7.500"/>'),
  plus: i('<path d="M12 5v14M5 12h14"/>'),
  copy: i('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>'),
  edit: i('<path d="M4 20l1-4.500L16.500 4a2.100 2.100 0 0 1 3 3L8 18.500Z"/>'),
};

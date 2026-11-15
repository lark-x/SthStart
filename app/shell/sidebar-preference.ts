export const SIDEBAR_COLLAPSE_KEY = 'sthstart_nav_collapsed';
export const SIDEBAR_BOOTSTRAP_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(SIDEBAR_COLLAPSE_KEY)})==='false')document.documentElement.dataset.navCollapsed='false'}catch{}`;

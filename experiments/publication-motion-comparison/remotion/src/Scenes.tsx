import {ComicScene} from './ComicScene';
import manifest from './manifest.json';
export const Camp=()=><ComicScene shot={manifest.shots[0]}/>;
export const Observation=()=><ComicScene shot={manifest.shots[1]}/>;
export const Notebook=()=><ComicScene shot={manifest.shots[2]}/>;
export const Crystal=()=><ComicScene shot={manifest.shots[3]}/>;
export const Understanding=()=><ComicScene shot={manifest.shots[4]}/>;
export const Unfinished=()=><ComicScene shot={manifest.shots[5]}/>;

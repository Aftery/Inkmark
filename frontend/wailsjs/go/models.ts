export namespace main {
	
	export class DirEntry {
	    name: string;
	    path: string;
	    isDir: boolean;
	    ext: string;
	
	    static createFrom(source: any = {}) {
	        return new DirEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.isDir = source["isDir"];
	        this.ext = source["ext"];
	    }
	}
	export class SnapshotMeta {
	    name: string;
	    size: number;
	    createdAt: number;
	    contentHash: string;
	
	    static createFrom(source: any = {}) {
	        return new SnapshotMeta(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.size = source["size"];
	        this.createdAt = source["createdAt"];
	        this.contentHash = source["contentHash"];
	    }
	}
	export class UpdateInfo {
	    status: string;
	    current: string;
	    latest: string;
	    hasUpdate: boolean;
	    url: string;
	    note: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.status = source["status"];
	        this.current = source["current"];
	        this.latest = source["latest"];
	        this.hasUpdate = source["hasUpdate"];
	        this.url = source["url"];
	        this.note = source["note"];
	    }
	}

}


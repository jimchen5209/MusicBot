import { createHash } from "crypto";
import { Collection, ObjectID } from "mongodb";
import { cpus } from "os";
import Queue from "promise-queue";
import { Core } from "..";
import { IAudioMetadata, UrlParser } from "./URLParser";
import { Encoder } from "./Utils/Encoder";

export interface IAudioData {
    _id?: ObjectID;
    title: string;
    artist?: string;
    duration: number;
    sender: ObjectID;
    source: string;
    size: number;
    hash: string;
}

export class AudioManager {
    public urlParser = new UrlParser();
    private encoder: Encoder;
    private database?: Collection;
    private metadataQueue = new Queue(cpus().length);
    private encodeQueue = new Queue(cpus().length);

    constructor(core: Core) {
        this.encoder = new Encoder(core.config);

        if (core.database.client) {
            this.database = core.database.client.collection("user");
        } else {
            core.database.on("connect", database => this.database = database.collection("sound"));
        }
    }

    public async add(sender: ObjectID, source: string, metadata?: IAudioMetadata) {
        if (!this.database) throw Error("Database is not initialized");

        const exist = await this.checkExist(source);
        if (exist) return exist;

        const info = await this.metadataQueue.add(() => this.urlParser.getMetadata(source));

        const title = (metadata && metadata.title) ? metadata.title : info.title;
        const artist = (metadata && metadata.artist) ? metadata.artist : info.artist;
        const duration = (metadata && metadata.duration) ? metadata.duration : info.duration;
        const size = (metadata && metadata.size) ? metadata.size : info.size;

        const hash = createHash("md5").update(title + artist + duration + size).digest("hex");

        const data: IAudioData = await this.checkExist(source, hash) || (await this.database.insertOne({
            artist,
            duration,
            hash,
            sender,
            size,
            source,
            title,
        })).ops[0];

        await this.encodeQueue.add(async () => this.encoder.encode(await this.urlParser.getFile(source), hash));
        return data;
    }

    public async edit(id: ObjectID, data: IAudioData) {
        if (!this.database) throw Error("Database is not initialized");

        return this.database.findOneAndUpdate({ _id: id }, {
            $set: {
                artist: data.artist,
                duration: data.duration,
                hash: data.hash,
                title: data.title,
            },
        }, { returnOriginal: false });
    }

    public async delete(id: ObjectID) {
        if (!this.database) throw Error("Database is not initialized");

        return this.database.deleteOne({ _id: id });
    }

    public async get(id: ObjectID) {
        if (!this.database) throw Error("Database is not initialized");

        return this.database.findOne<IAudioData>({ _id: id });
    }

    public search(metadata?: IAudioMetadata) {
        if (!this.database) throw Error("Database is not initialized");

        return this.database.find<IAudioData>(metadata);
    }

    private async checkExist(source?: string, hash?: string) {
        if (!this.database) throw Error("Database is not initialized");

        return this.database.findOne<IAudioData>({ $or: [{ source }, { hash }] });
    }
}
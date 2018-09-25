"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const readline_1 = require("readline");
const fs_1 = require("fs");
var ReaderState;
(function (ReaderState) {
    ReaderState[ReaderState["UNDETERMINED"] = 0] = "UNDETERMINED";
    ReaderState[ReaderState["READ_TRACE_EVENTS"] = 1] = "READ_TRACE_EVENTS";
    ReaderState[ReaderState["READ_STACK_FRAMES"] = 2] = "READ_STACK_FRAMES";
    ReaderState[ReaderState["READ_OTHER_DATA"] = 3] = "READ_OTHER_DATA";
})(ReaderState || (ReaderState = {}));
const PID = 0;
const TID = 0;
class ChromeProfilerExportConverter {
    lineStartsWith(prefix) {
        return this.currentLine.startsWith(prefix);
    }
    lineEndsWith(suffix) {
        return this.currentLine.endsWith(suffix);
    }
    getFirstMatch(pattern) {
        var matches = this.currentLine.match(pattern);
        if (matches.length > 1) {
            return matches[1];
        }
        else {
            throw new Error(`No matches for pattern "${pattern}" in line "${this.currentLine}".`);
        }
    }
    getMatches(pattern) {
        var matches = this.currentLine.match(pattern);
        matches.shift();
        return matches;
    }
    findNextState() {
        if (this.lineStartsWith("    [\"traceEvents\"]")) {
            return ReaderState.READ_TRACE_EVENTS;
        }
        else if (this.lineStartsWith("    [\"stackFrames\"]")) {
            return ReaderState.READ_STACK_FRAMES;
        }
        else if (this.lineStartsWith("    [\"otherData\"]")) {
            return ReaderState.READ_OTHER_DATA;
        }
        else {
            return ReaderState.UNDETERMINED;
        }
    }
    readTraceEvents() {
        if (this.lineStartsWith("    },")) {
            // section ended
            return true;
        }
        if (this.lineStartsWith("        [")) {
            let data = this.getFirstMatch(/= "(.+)",$/).split(",");
            let event = {
                name: "",
                cat: "EsoUI",
                ph: "X",
                ts: parseFloat(data[0]),
                dur: parseFloat(data[1]),
                pid: PID,
                tid: TID,
                sf: data[2]
            };
            this.data.traceEvents.push(event);
        }
        return false;
    }
    readStackFrames() {
        if (this.lineStartsWith("    },")) {
            // section ended
            return true;
        }
        if (this.lineStartsWith("        [")) {
            let [stackId, data] = this.getMatches(/\[(.+)\] = "(.+)",$/);
            let [name, file, line, parent] = data.split(",");
            let stackFrame = {
                name: name + " (" + file + ":" + line + ")",
            };
            if (parent) {
                stackFrame["parent"] = parent;
            }
            this.data.stackFrames[stackId] = stackFrame;
            this.names[stackId] = name;
            let matches = file.match(/@user:\/AddOns\/(.+?)\//);
            if (matches && matches.length > 1) {
                this.categories[stackId] = matches[1];
            }
        }
        return false;
    }
    readOtherData() {
        if (this.lineStartsWith("    },")) {
            // section ended
            return true;
        }
        if (this.lineStartsWith("        [")) {
            let [key, value] = this.getMatches(/\["(.+)"\] = "?(.+)"?,$/);
            this.data.otherData[key] = value;
            if (key === "upTime") {
                this.uptime = Math.floor(parseFloat(value) / 1e6);
            }
        }
        return false;
    }
    onReadLine(line) {
        this.currentLine = line;
        let finished = false;
        switch (this.state) {
            case ReaderState.READ_TRACE_EVENTS:
                finished = this.readTraceEvents();
                break;
            case ReaderState.READ_STACK_FRAMES:
                finished = this.readStackFrames();
                break;
            case ReaderState.READ_OTHER_DATA:
                finished = this.readOtherData();
                break;
            case ReaderState.UNDETERMINED:
            default:
                this.state = this.findNextState();
        }
        if (finished) {
            this.state = this.findNextState();
        }
    }
    fillInNames() {
        let eventData = [];
        this.data.traceEvents.forEach(event => {
            event.name = this.names[event.sf];
            if (this.categories[event.sf]) {
                event.cat = this.categories[event.sf];
            }
        });
        this.data.traceEvents = this.data.traceEvents.concat(eventData);
    }
    writeFile() {
        let outputFile = this.fileName.replace(".lua", ".json");
        let output = JSON.stringify(this.data, null, 2);
        fs_1.writeFileSync(outputFile, output, "utf8");
    }
    addMetaData(name, args) {
        this.data.traceEvents.unshift({
            name: name,
            cat: "__metadata",
            ts: 0,
            ph: "M",
            args: args,
            pid: PID,
            tid: TID
        });
    }
    parseFile(resolve, reject) {
        this.names = {};
        this.categories = {};
        this.data = {
            traceEvents: [],
            stackFrames: {},
            otherData: {},
        };
        this.state = ReaderState.UNDETERMINED;
        let reader = readline_1.createInterface({
            input: fs_1.createReadStream(this.fileName),
            crlfDelay: Infinity
        });
        console.log("read file", this.fileName);
        reader.on("line", (line) => this.onReadLine(line));
        reader.on("close", () => {
            this.fillInNames();
            this.addMetaData("process_name", { "name": "eso64.exe" });
            this.addMetaData("process_uptime_seconds", { "uptime": this.uptime });
            this.addMetaData("thread_name", { "name": "User Interface" });
            console.log("finished reading");
            resolve(this.data);
        });
    }
    convert(fileName) {
        this.fileName = fileName;
        return new Promise(this.parseFile.bind(this));
    }
}
exports.ChromeProfilerExportConverter = ChromeProfilerExportConverter;

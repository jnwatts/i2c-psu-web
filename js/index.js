import { serial as polyfill } from './serial-polyfill.js';

let serial = polyfill;

if (navigator.serial)
    serial = navigator.serial;

document.querySelector('.add-device-button').addEventListener('click', async () =>
{
    const port = await serial.requestPort({});

    console.log('new port', port);

    if (!Array.from(document.querySelector('serial-devices').children).some(child => child.port === port || (child.port.device_ !== undefined && (child.port.device_.serialNumber === port.device_.serialNumber))))
    {
        const serialDevice = new SerialDevice(port);

        document.querySelector('serial-devices').appendChild(serialDevice);
    }
});

class SerialDevices extends HTMLElement
{
    constructor()
    {
        super();
    }

    async connectedCallback()
    {
        serial.addEventListener('connect', e =>
        {
            if (!Array.from(this.children).some(child => child.port === e.target))
            {
                const serialDevice = new SerialDevice(e.target);

                this.appendChild(serialDevice);
            }
        });

        serial.addEventListener('disconnect', e =>
        {
            console.log('serial disconnect', e);
            Array.from(this.children).forEach(child =>
            {
                if (child.port === e.target || (child.port.device_ !== undefined && (child.port.device_.serialNumber === e.target.device_.serialNumber)))
                    this.removeChild(child);
            });
        });

        const ports = await serial.getPorts();

        ports.forEach(port =>
        {
            const serialDevice = new SerialDevice(port);

            this.appendChild(serialDevice);
        });
    }

    disconnectedCallback()
    {

    }

    adoptedCallback()
    {
        console.log('adopted');
    }

    attributeChangedCallback(name, oldValue, newValue)
    {
        console.log(`Attribute: ${name} changed from ${oldValue} to ${newValue}`);
    }
}

class SerialDevice extends HTMLElement
{
    port = null;
    model = null;
    name = null;
    serialNumber = null;
    address = "00";

    reader = null;

    encoder = new TextEncoder();
    decoder = new TextDecoder();

    command = null;
    commands = [];
    debugCommands = false;

    vsetSlider = null;
    vsetValue = null;

    isetSlider = null;
    isetValue = null;

    outModeCVIndicator = null;
    outModeCCIndicator = null;

    stateRelayIndicator = null;
    stateOutputIndicator = null;
    stateLockIndicator = null;
    statePlayIndicator = null;

    vset = 0;
    iset = 0;
    vout = 0;
    iout = 0;
    pout = 0;
    tout = 0;
    outMode = 'CV';
    stateRelay = false;
    stateOutput = false;
    stateLock = false;
    statePlay = false;

    playWriter = null;
    playStream = null;
    playProcessor = null;

    constructor(port)
    {
        super();

        this.port = port;
        this.classList.add('discovering');
    }

    initDisplay()
    {
        if (!this.classList.contains('discovering')) {
            return;
        }
        this.classList.remove('discovering');

        const idParts = "0,bk1696,bk1696,".split(',');

        this.model = idParts[1];
        this.name = idParts[2];
        this.serialNumber = idParts[3];

        const template = document.getElementById('serial-device-template');

        const clone = template.content.cloneNode(true);

        clone.querySelector('.model-image').src = `img/devices/${this.model}.svg`;
        clone.querySelector('.name').innerText = this.name;
        clone.querySelector('.serial-number').innerText = this.serialNumber;

        clone.querySelector('.device-actions').addEventListener('click', async e =>
        {
            this.port.forget();
        });

        this.replaceChildren(clone);

        this.vsetSlider = this.querySelector('.vset-slider');
        this.vsetValue = this.querySelector('.vset-value');

        this.vsetSlider.addEventListener('input', async e => {
            var v = parseFloat(e.target.value);
            this.vset = v;
            this.updateVsetRangeValue();
            this.setVset(v);
        });

        this.voutValue = this.querySelector('.vout-value');

        this.isetSlider = this.querySelector('.iset-slider');
        this.isetValue = this.querySelector('.iset-value');

        this.isetSlider.addEventListener('input', async e => {
            var v = parseFloat(e.target.value);
            this.iset = v;
            this.updateIsetRangeValue();
            this.setIset(v);
        });

        this.ioutValue = this.querySelector('.iout-value');

        this.outModeCVIndicator = this.querySelector('.vout-cv-mode');
        this.outModeCCIndicator = this.querySelector('.iout-cc-mode');

        this.stateOutputIndicator = this.querySelector('.output-state');
        this.stateOutputIndicator.addEventListener('click', async e =>
        {
            this.setOutput(!this.stateOutput);
        });

        this.stateLockIndicator = this.querySelector('.lock-state');
        this.stateLockIndicator.addEventListener('click', async e =>
        {
            this.setLock(!this.stateLock);
        });
    }

    async connectedCallback()
    {
        console.log('my port is', this.port);

        this.innerHTML = '<span>Discovering device</span>';

        try
        {
            await this.port.open({
                baudRate: 9600,
                bufferSize: 1024,
            });

            this.reader = this.port.readable.getReader();

            this.readSerial();

            setTimeout(() =>
            {
                if (this.classList.contains('discovering'))
                {
                    this.classList.remove('discovering');
                    this.classList.add('unknown-device');

                    this.innerHTML = '<span class="warning-icon">⚠</span> <span>Unknown device</span>';

                    setTimeout(() =>
                    {
                        this.port.forget();
                    }, 4000);
                }
            }, 4000);

            this.initDisplay();

            await this.getInitialState();

            globalThis.write = this.writeCommand.bind(this);
        }
        catch (error)
        {
            console.log('error', error);

            this.classList.remove('discovering');
            this.classList.add('unknown-device');

            this.innerHTML = `<span class="warning-icon">⚠</span> <span>Unable to connect to device</span>`;

            this.port.forget();

            setTimeout(() =>
            {
                this.parentElement.removeChild(this);
            }, 4000);
        }
    }

    pendingCommand(cmd)
    {
        return this.commands.find((c) => {
            return c.cmd == cmd;
        });
    }

    commLog(...args)
    {
        if (this.debugCommands) {
            console.log(...args);
        }
    }

    async writeCommand(cmd, args="")
    {
        cmd = cmd.toUpperCase();
        if (this.command !== null) {
            var c = this.pendingCommand(cmd);
            if (c === undefined) {
                this.commands.push({cmd: cmd, args: args, ts: Date.now()});
            } else {
                c.args = args;
                this.commLog("UDPATE", cmd, args);
            }
            return;
        }

        this.command = cmd;

        const writer = this.port.writable.getWriter();
        var line = `${cmd}${this.address}${args}`
        this.commLog("WRITE", line);
        await writer.write(this.encoder.encode(`${line}\r`));
        writer.releaseLock();
    }

    async completeCommand()
    {
        this.commLog("COMPLETE", this.command);
        this.command = null;
        if (this.commands.length > 0) {
            this.commands.sort((a, b) => {
                return a.ts - b.ts;
            });
            var c = this.commands.shift();
            this.commLog("SHIFT", c);
            await this.writeCommand(c.cmd, c.args);
        }
    }

    async readSerial()
    {
        let buffer = '';
        let lines = [];

        while(this.port.readable)
        {
            try
            {
                while (true)
                {
                    const { value, done } = await this.reader.read();


                    if (done) {
                        break;
                    }


                    buffer += this.decoder.decode(value);

                    if (buffer.indexOf('\r') !== -1)
                    {
                        const newLines = buffer.split('\r');
                        buffer = newLines.pop();
                        lines.push(...newLines);

                        if (this.command == null) {
                            lines = [];
                            continue;
                        }

                        var num_lines = lines.length; // lines will be modified in the loop
                        for (let i = 0; i < num_lines; i++) {
                            if (this.command == null) {
                                this.commLog("Unexpected data", lines);
                                lines = [];
                                break;
                            }

                            var linePart = lines.shift();

                            this.commLog("READ", linePart);
                            if (linePart == "OK" || linePart == "ERR") {
                                await this.completeCommand();
                                continue;
                            }

                            if (this.command == "GPAL") { this.handleGPAL(linePart); }
                        }
                    }
                }
            }
            finally
            {
                this.reader.releaseLock();
            }
        }

        this.parentElement.removeChild(this);
    }

    handleGPAL(val)
    {
        var binaryDecode = function(data) {
            var p = "";
            var float = false;
            if (data.length & 1 == 1)
                return null;
            for (let i = 0; i < data.length; i += 2) {
                var t = data[i].charCodeAt(0) - 0x30;
                t <<= 4;
                t |= data[i+1].charCodeAt(0) - 0x30;
                var v = (t & 0x7F);
                if (v == 0b0000000) { p += ' '; }
                else if (v == 0b0111111) { p += '0'; }
                else if (v == 0b0000110) { p += '1'; }
                else if (v == 0b1011011) { p += '2'; }
                else if (v == 0b1001111) { p += '3'; }
                else if (v == 0b1100110) { p += '4'; }
                else if (v == 0b1101101) { p += '5'; }
                else if (v == 0b1111101) { p += '6'; }
                else if (v == 0b0000111) { p += '7'; }
                else if (v == 0b1111111) { p += '8'; }
                else if (v == 0b1101111) { p += '9'; }
                if (t & 0x80) { p += '.'; float = true; }
            }
            if (float) {
                return parseFloat(p);
            }
            return parseInt(p);
        };
        var booleanDecode = function(data) {
            // LED segment values are ACTIVE LOW!
            // 0 == ENABLED
            // 1 == DISABLED
            return (data == 0);
        };

        var parseResponse = function(data, transforms) {
            return transforms.map(function(t) {
                var start = t[0] - 1;
                var len = (t[1] === 0 ? 1 : t[1] - t[0] + 1);
                var value = data.substr(start, len)
                if (t[2] === null)
                    return value;
                return t[2](value);
            });
        };

        var data = parseResponse(val, [
            [1,  8,  binaryDecode],     // Voltage
            [9,  0,  null],             // Reserved
            [10, 17, binaryDecode],     // Current
            [18, 0,  null],             // Reserved
            [19, 26, binaryDecode],     // Power
            [27, 0,  null],             // Reserved
            [28, 31, binaryDecode],     // Minutes on Timer
            [32, 35, binaryDecode],     // Seconds on Timer
            [36, 0,  null],             // "Timer"
            [37, 0,  null],             // ":"
            [38, 0,  null],             // Reserved
            [39, 0,  null],             // Reserved
            [40, 45, binaryDecode],     // Setting Voltage
            [46, 0,  booleanDecode],    // "V-const"
            [47, 0,  null],             // "V-set"
            [48, 0,  null],             // "V"
            [49, 54, binaryDecode],     // Setting Current
            [55, 0,  booleanDecode],    // "I-const"
            [56, 0,  null],             // "I-set"
            [57, 0,  null],             // "A"
            [58, 59, binaryDecode],     // Program number
            [60, 0,  null],             // "Program"
            [61, 0,  null],             // Reserved
            [62, 0,  null],             // "Setting"
            [63, 0,  booleanDecode],    // Key Lock
            [64, 0,  null],             // Key Unlock
            [65, 0,  null],             // "Fault"
            [66, 0,  booleanDecode],    // Output ON
            [67, 0,  null],             // Output OFF
            [68, 0,  null],             // Remote mode
        ]);

        var READING_VOLTAGE = 0;
        var READING_CURRENT = 2;
        var READING_POWER = 4;
        var SETTING_VOLTAGE = 12;
        var VCONST = 13;
        var SETTING_CURRENT = 16;
        var ICONST = 17;
        var KEY_LOCK = 24;
        var KEY_UNLOCK = 25;
        var OUTPUT_ON = 27;
        var OUTPUT_OFF = 28;

        try {
            this.updateVout(data[READING_VOLTAGE]);
            this.updateVset(data[SETTING_VOLTAGE]);
            this.updateIout(data[READING_CURRENT]);
            this.updateIset(data[SETTING_CURRENT]);
            this.updatePowerLabel();
            this.updateOutputState(data[OUTPUT_ON]);
            this.udpateLockState(data[KEY_LOCK]);
            this.updateOutModeCV(data[VCONST]);
            this.updateOutModeCC(data[ICONST]);
        // } catch (e) {
            // Don't worry about it, just try again on next round
        } finally {
        }
    }

    disconnectedCallback()
    {

    }

    adoptedCallback()
    {
        console.log('adopted');
    }

    attributeChangedCallback(name, oldValue, newValue)
    {
        console.log(`Attribute: ${name} changed from ${oldValue} to ${newValue}`);
    }

    async getInitialState()
    {
        await this.writeCommand('GPAL');
        const statusInterval = setInterval(async () =>
        {
            if (!this.port.writable)
            {
                clearInterval(statusInterval);
                return;
            }

            if (!this.statePlay)
                await this.writeCommand('GPAL');
        }, 100);
    }

    updateVset(val)
    {
        this.vset = val;
        this.vsetSlider.value = val;
        this.updateVsetRangeValue();
    }

    updateVout(val)
    {
        this.vout = val;
        this.voutValue.innerHTML = val.toFixed(2).padStart(5, '\u00A0');
    }

    updateVsetRangeValue()
    {
        const newValue = Number( (this.vsetSlider.value) * 100 / this.vsetSlider.max );
        const newPosition = 4 - (newValue * 0.32);
        this.vsetValue.innerHTML = `<span>${this.decimalDisplay(2,1,parseFloat(this.vsetSlider.value))} V</span>`;
        this.vsetValue.style.bottom = `calc(${newValue}% + (${newPosition}px))`;
    }

    updateIset(val)
    {
        this.iset = val;
        this.isetSlider.value = val;
        this.updateIsetRangeValue();
    }

    updateIout(val)
    {
        this.iout = val;
        this.ioutValue.innerText = val.toFixed(3).substr(0, 5);
    }

    updateIsetRangeValue()
    {
        const newValue = Number( (this.isetSlider.value - this.isetSlider.min) * 100 / (this.isetSlider.max - this.isetSlider.min) );
        const newPosition = 3 - (newValue * 0.31);
        this.isetValue.innerHTML = `<span>${this.decimalDisplay(1,2,parseFloat(this.isetSlider.value))} A</span>`;
        this.isetValue.style.bottom = `calc(${newValue}% + (${newPosition}px)`;
    }

    updatePowerLabel()
    {
        var val = this.vout * this.iout;
        this.querySelector('.pout-value').innerText = val.toFixed(3).substr(0, 5);
    }

    updateOutputState(val)
    {
        this.stateOutput = val;
        this.stateOutputIndicator.classList.toggle('active', this.stateOutput);
        this.stateOutputIndicator.querySelector('.state-value').innerText = this.stateOutput ? 'ON' : 'OFF';
    }

    udpateLockState(val)
    {
        this.stateLock = val;
        this.stateLockIndicator.classList.toggle('active', this.stateLock);
        if (this.stateLock)
            this.stateLockIndicator.querySelector('.lock-value-img').src = 'img/locked.svg';
        else
            this.stateLockIndicator.querySelector('.lock-value-img').src = 'img/unlocked.svg';
    }

    updateOutModeCV(val)
    {
        this.outModeCV = val;
        this.outModeCVIndicator.style.opacity = (!!val) ? 1 : 0;
    }

    updateOutModeCC(val)
    {
        this.outModeCC = val;
        this.outModeCCIndicator.style.opacity = (!!val) ? 1 : 0;
    }

    setOutput(val)
    {
        this.writeCommand('SOUT', (!!val) ? '0' : '1'); // 0 == ON, 1 == OFF
    }

    setLock(val)
    {
        this.writeCommand((!!val) ? 'SESS' : 'ENDS'); // SESS == Disable front keypad for remote mode, ENDS == enable front keypad for local mode
    }

    setVset(val)
    {
        this.writeCommand('VOLT', this.decimalEncode(2,1,val));
    }

    setIset(val)
    {
        this.writeCommand('CURR', this.decimalEncode(1,2,val));
    }

    decimalDisplay(whole, part, data)
    {
        return data.toFixed(part).padStart(whole + part + 1, '0');
    }

    decimalEncode(whole, part, data)
    {
        return data.toFixed(part).padStart(whole + part + 1, '0').replace('.', '');
    }

    showAlert(message)
    {
        this.querySelector('.alert-popup-message').innerText = message;
        this.querySelector('.alert-popup-overlay').style.display = 'flex';

        this.querySelector('.vset-slider').disabled = true;
        this.querySelector('.iset-slider').disabled = true;

        setTimeout(() =>
        {
            this.querySelector('.vset-slider').disabled = this.stateLock;
            this.querySelector('.iset-slider').disabled = this.stateLock;
            this.querySelector('.alert-popup-overlay').style.display = 'none';
        }, 4000);
    }
}

customElements.define('serial-devices', SerialDevices);
customElements.define('serial-device', SerialDevice);

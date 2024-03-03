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

    reader = null;

    encoder = new TextEncoder();
    decoder = new TextDecoder();

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

    async connectedCallback()
    {
        console.log('my port is', this.port);

        this.innerHTML = '<span>Discovering device</span>';

        try
        {
            await this.port.open({
                baudRate: 115200,
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

            await this.writeLine('id');

            globalThis.write = this.writeLine.bind(this);
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

    async writeLine(line)
    {
        const writer = this.port.writable.getWriter();
        await writer.write(this.encoder.encode(`${line}\n`));

        writer.releaseLock();
    }

    async readSerial()
    {
        let line = '';

        while(this.port.readable)
        {
            try
            {
                while (true)
                {
                    const { value, done } = await this.reader.read();

                    if (done)
                        break;

                    line += this.decoder.decode(value);

                    if (line.indexOf('\n') !== -1)
                    {
                        const lineParts = line.split('\n');

                        line = lineParts.pop();

                        lineParts.forEach(async linePart =>
                        {
                            console.log(linePart);

                            if (linePart.indexOf('id,') === 0)
                            {
                                this.classList.remove('discovering');

                                const idParts = linePart.split(',');

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
                                    this.vset = e.target.value;
                                    this.updateVsetRangeValue();
                                    await this.writeLine(`vset,${e.target.value}`);
                                });


                                this.isetSlider = this.querySelector('.iset-slider');
                                this.isetValue = this.querySelector('.iset-value');

                                this.isetSlider.addEventListener('input', async e => {
                                    this.iset = e.target.value;
                                    this.updateIsetRangeValue();
                                    await this.writeLine(`iset,${e.target.value}`);
                                });

                                this.outModeCVIndicator = this.querySelector('.vout-cv-mode');
                                this.outModeCCIndicator = this.querySelector('.iout-cc-mode');

                                this.stateRelayIndicator = this.querySelector('.relay-state');
                                this.stateRelayIndicator.addEventListener('click', async e =>
                                {
                                    await this.writeLine(`relay,${this.stateRelay ? 'off' : 'on'}`);
                                });

                                this.stateOutputIndicator = this.querySelector('.output-state');
                                this.stateOutputIndicator.addEventListener('click', async e =>
                                {
                                    await this.writeLine(`output,${this.stateOutput ? 'off' : 'on'}`);
                                });

                                this.stateLockIndicator = this.querySelector('.lock-state');
                                this.stateLockIndicator.addEventListener('click', async e =>
                                {
                                    await this.writeLine(`lock,${this.stateLock ? 'off' : 'on'}`);
                                });

                                this.buildWave();

                                this.statePlayIndicator = this.querySelector('.play-state');
                                this.statePlayIndicator.addEventListener('click', async e =>
                                {
                                    if (this.statePlay)
                                    {
                                        this.stop();
                                    }
                                    else
                                    {

                                        this.querySelector('.play-popup-overlay').style.display = 'flex';
                                    }
                                });

                                this.querySelector('.play-popup-overlay').addEventListener('click', async e =>
                                {
                                    this.querySelector('.play-popup-overlay').style.display = 'none';
                                });

                                this.querySelector('.play-file').addEventListener('click', async e =>
                                {
                                    this.querySelector('.play-popup-overlay').style.display = 'none';
                                    this.playFile();
                                });

                                this.querySelector('.play-stream').addEventListener('click', async e =>
                                {
                                    this.querySelector('.play-popup-overlay').style.display = 'none';
                                    this.play();
                                });

                                globalThis.speed = this.speed.bind(this);

                                this.getInitialState();

                                const statusInterval = setInterval(async () =>
                                {
                                    if (!this.port.writable)
                                    {
                                        clearInterval(statusInterval);
                                        return;
                                    }

                                    if (!this.statePlay)
                                        await this.writeLine('status');
                                }, 100);
                            }
                            else if (!this.classList.contains('discovering'))
                            {
                                if (linePart.indexOf('vset,') === 0)
                                {
                                    const vsetParts = linePart.split(',');
                                    this.vset = Number(vsetParts[1]);

                                    this.vsetSlider.value = vsetParts[1];
                                    this.updateVsetRangeValue();
                                }
                                else if (linePart.indexOf('iset,') === 0)
                                {
                                    const isetParts = linePart.split(',');
                                    this.iset = Number(isetParts[1]);

                                    this.isetSlider.value = isetParts[1];
                                    this.updateIsetRangeValue();
                                }
                                else if (linePart.indexOf('status,') === 0)
                                {
                                    const statusParts = linePart.split(',');
                                    const statusScope = statusParts[1];
                                    const statusParam = statusParts[2];
                                    const statusValue = statusParts[3];

                                    switch(statusScope)
                                    {
                                        case 'ina228':
                                        {
                                            switch(statusParam)
                                            {
                                                case 'vout':
                                                {
                                                    let vout = Number(statusValue);
                                                    if (vout < 0)
                                                        vout = 0;

                                                    this.vout = vout;

                                                    this.querySelector('.vout-value').innerText = vout.toFixed(2);
                                                    this.updatePowerLabel();
                                                }
                                                break;

                                                case 'iout':
                                                {
                                                    let iout = Number(statusValue);
                                                    if (iout < 0)
                                                        iout = 0;

                                                    this.iout = iout;

                                                    this.querySelector('.iout-value').innerText = iout.toFixed(3);
                                                    this.updatePowerLabel();
                                                }
                                                break;
                                            }
                                        }
                                        break;

                                        case 'tmp100':
                                        {
                                            switch(statusParam)
                                            {
                                                case 'temp':
                                                {
                                                    let temp = Number(statusValue);

                                                    this.tout = temp;

                                                    this.querySelector('.tout-value').innerText = temp.toFixed(1);
                                                
                                                }
                                                break;
                                            }
                                        }

                                        case 'tps55289':
                                        {
                                            switch(statusParam)
                                            {
                                                // short circuit protection
                                                case 'scp':
                                                {
                                                    
                                                }
                                                break;
                                                
                                                // over current protection
                                                case 'ocp':
                                                {
                                                    if (statusValue == 'true')
                                                    {
                                                        this.outMode = 'CC';
                                                        this.outModeCVIndicator.style.opacity = 0;
                                                        this.outModeCCIndicator.style.opacity = 1;
                                                    }
                                                    else
                                                    {
                                                        this.outMode = 'CV';
                                                        this.outModeCVIndicator.style.opacity = 1;
                                                        this.outModeCCIndicator.style.opacity = 0;
                                                    }
                                                }
                                                break;

                                                case 'brownout':
                                                {
                                                    if (statusValue == 'true')
                                                    {
                                                        this.showAlert('BROWNOUT');
                                                        this.getInitialState();
                                                    }
                                                }
                                                break;
                                            }

                                        }
                                        break;
                                    }

                                }
                                else if (linePart.indexOf('relay,') === 0)
                                {
                                    const relayParts = linePart.split(',');
                                    this.stateRelay = relayParts[1] === 'on';
                                    this.stateRelayIndicator.classList.toggle('active', this.stateRelay);
                                    this.stateRelayIndicator.querySelector('.state-value').innerText = this.stateRelay ? 'ON' : 'OFF';
                                }
                                else if (linePart.indexOf('output,') === 0)
                                {
                                    const outputParts = linePart.split(',');
                                    this.stateOutput = outputParts[1] === 'on';
                                    this.stateOutputIndicator.classList.toggle('active', this.stateOutput);
                                    this.stateOutputIndicator.querySelector('.state-value').innerText = this.stateOutput ? 'ON' : 'OFF';
                                }
                                else if (linePart.indexOf('lock,') === 0)
                                {
                                    const lockParts = linePart.split(',');
                                    this.stateLock = lockParts[1] === 'on';
                                    this.stateLockIndicator.classList.toggle('active', this.stateLock);

                                    this.querySelector('.vset-slider').disabled = this.stateLock;
                                    this.querySelector('.iset-slider').disabled = this.stateLock;

                                    if (this.stateLock)
                                        this.stateLockIndicator.querySelector('.lock-value-img').src = 'img/locked.svg';
                                    else
                                        this.stateLockIndicator.querySelector('.lock-value-img').src = 'img/unlocked.svg';
                                }
                            }
                            
                        });
                    }
                }
            }
            catch (error)
            {
                console.log('error', error);
            }
            finally
            {
                this.reader.releaseLock();
            }
        }

        this.stop();

        this.parentElement.removeChild(this);
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
        await this.writeLine('vset');
        await this.writeLine('iset');
        await this.writeLine('relay');
        await this.writeLine('output');
        await this.writeLine('lock');
    }

    updateVsetRangeValue()
    {
        const newValue = Number( (this.vsetSlider.value) * 100 / this.vsetSlider.max );
        const newPosition = 4 - (newValue * 0.32);
        this.vsetValue.innerHTML = `<span>${Number(this.vsetSlider.value).toFixed(2)} V</span>`;
        this.vsetValue.style.bottom = `calc(${newValue}% + (${newPosition}px))`;
    }

    updateIsetRangeValue()
    {
        const newValue = Number( (this.isetSlider.value - this.isetSlider.min) * 100 / (this.isetSlider.max - this.isetSlider.min) );
        const newPosition = 3 - (newValue * 0.31);
        this.isetValue.innerHTML = `<span>${Number(this.isetSlider.value).toFixed(3)} A</span>`;
        this.isetValue.style.bottom = `calc(${newValue}% + (${newPosition}px)`;
    }

    updatePowerLabel()
    {
        this.querySelector('.pout-value').innerText = (this.vout * this.iout).toFixed(2);
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

    buildWave()
    {
        const h = 20;

        const path = document.querySelector('#wave');
        const m = 0.512286623256592433;

        const a = h / 2;
        const y = h / 2;

        const pathData = [
        'M', 0, y + a / 2,
        'c',
        a * m, 0,
        -(1 - a) * m, -a,
        a, -a,
        's',
        -(1 - a) * m, a,
        a, a,
        's',
        -(1 - a) * m, -a,
        a, -a,
        's',
        -(1 - a) * m, a,
        a, a,
        's',
        -(1 - a) * m, -a,
        a, -a,

        's',
        -(1 - a) * m, a,
        a, a,
        's',
        -(1 - a) * m, -a,
        a, -a,
        's',
        -(1 - a) * m, a,
        a, a,
        's',
        -(1 - a) * m, -a,
        a, -a,
        's',
        -(1 - a) * m, a,
        a, a,
        's',
        -(1 - a) * m, -a,
        a, -a,
        's',
        -(1 - a) * m, a,
        a, a,
        's',
        -(1 - a) * m, -a,
        a, -a,
        's',
        -(1 - a) * m, a,
        a, a,
        's',
        -(1 - a) * m, -a,
        a, -a].
        join(' ');

        path.setAttribute('d', pathData);
    }

    async play()
    {
        const displayMediaOptions = {
            video: {
                displaySurface: "browser",
            },
            audio: {
                suppressLocalAudioPlayback: true,
                autoGainControl: false,
                echoCancellation: false,
                noiseSuppression: false,
            },
            preferCurrentTab: false,
            selfBrowserSurface: "exclude",
            systemAudio: "include",
            surfaceSwitching: "include",
            monitorTypeSurfaces: "include",
        };

        const audioCtx = new AudioContext({
            sampleRate: 14300,
            //sampleRate: 10265,
            //sampleRate: 15305,
        });

        this.playStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);

        const source = audioCtx.createMediaStreamSource(this.playStream);
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 3000;
        filter.Q.value = 10;
        this.playProcessor = audioCtx.createScriptProcessor(1024, 1, 1);
        source.connect(filter);
        filter.connect(this.playProcessor);
        this.playProcessor.connect(audioCtx.destination);

        await this.writeLine('play,5');
        this.playWriter = this.port.writable.getWriter();

        this.statePlay = true;
        this.statePlayIndicator.classList.add('active');
        this.statePlayIndicator.querySelector('.play-value-img').style.display = 'none';
        this.statePlayIndicator.querySelector('.play-value-animation').style.display = 'block';

        this.playProcessor.onaudioprocess = async e =>
        {
            const input = e.inputBuffer.getChannelData(0);

            const uint8Data = Uint8Array.from(input.map(x => x * 127.5 + 127.5));

            this.playWriter.write(uint8Data);
        };

        this.playStream.getTracks().forEach(tr => tr.onended = async () =>
        {
            this.stop();
            this.playProcessor.disconnect();
        });
    }

    async playFile()
    {
        // const audioData = await fetch("wav/anri.mp3").then(r => r.arrayBuffer());

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'audio/*';
        fileInput.click();

        fileInput.addEventListener('change', async e =>
        {
            const file = e.target.files[0];
            const audioData = await file.arrayBuffer();

            await this.playAudio(audioData);
        });
    }

    async playAudio(audioData)
    {
        const audioCtx = new AudioContext({
            sampleRate: 14300,
        });

        const decodedData = await audioCtx.decodeAudioData(audioData); // audio is resampled to the AudioContext's sampling rate

        this.statePlay = true;
        this.statePlayIndicator.classList.add('active');
        this.statePlayIndicator.querySelector('.play-value-img').style.display = 'none';
        this.statePlayIndicator.querySelector('.play-value-animation').style.display = 'block';

        let buffer;

        if (decodedData.numberOfChannels === 1)
            buffer = decodedData.getChannelData(0);
        else
        {
            // mix all of the channels into a single channel
            const channels = Array.from({ length: decodedData.numberOfChannels }, (_, i) => decodedData.getChannelData(i));
            const mixedChannel = channels[0];
            for (let i = 0; i < decodedData.length; i++)
            {
                // making the values can't exceed 1 or -1, so we can convert to 8-bit unsigned integer later
                for (let j = 1; j < channels.length; j++)
                {
                    mixedChannel[i] += channels[j][i];
                }

                mixedChannel[i] /= decodedData.numberOfChannels;
            }

            buffer = mixedChannel;
        }

        const uint8Data = Uint8Array.from(buffer.map(x => x * 127.5 + 127.5));

        await this.writeLine('play,5');
        this.playWriter = this.port.writable.getWriter();

        const chunks = [];

        for(let i = 0; i < uint8Data.length; i += 1024)
        {
            const chunk = uint8Data.slice(i, i + 1024);
            chunks.push(chunk);
        }

        for(const chunk of chunks)
        {
            try {
                await this.playWriter.write(chunk);
            } catch (error) {
                console.log('error', error);
                break;
            }
        }

        this.stop();
    }

    async stop()
    {
        try {
            this.playStream.getTracks().forEach(tr => tr.stop());
        } catch (error) {
            console.log('error', error);
        }

        try {
            this.playProcessor.disconnect();
        } catch (error) {
            console.log('error', error);
        }

        this.statePlay = false;
        this.statePlayIndicator.querySelector('.play-value-img').style.display = 'block';
        this.statePlayIndicator.querySelector('.play-value-animation').style.display = 'none';

        this.statePlayIndicator.classList.remove('active');

        try {
            await this.playWriter.close();
        } catch (error) {
            console.log('error', error);
        }

        setTimeout(async () => {

            try {
                await this.playWriter.ready;
            } catch (error) {
                console.log('error', error);
            }

            try {
                await this.playWriter.close();
            } catch (error) {
                console.log('error', error);
            }

            this.port.setSignals({ dataTerminalReady: false });
            setTimeout(() => {
                this.port.setSignals({ dataTerminalReady: true });
                this.playWriter.releaseLock();
            }, 100);
        }, 100);
    }

    async speed()
    {
        await this.writeLine('speed');

        const writer = this.port.writable.getWriter();

        const buffer = new Uint8Array(1024);

        for (let i = 0; i < buffer.length; i++)
        {
            buffer[i] = i;
        }

        for (let i = 0; i < 100; i++)
        {
            await writer.write(buffer);
        }

        await writer.releaseLock();

        setTimeout(() => {
            this.port.setSignals({ dataTerminalReady: false });
            setTimeout(() => {
                this.port.setSignals({ dataTerminalReady: true });
            }, 100);
        }, 100);
        
    
    }
}

customElements.define('serial-devices', SerialDevices);
customElements.define('serial-device', SerialDevice);
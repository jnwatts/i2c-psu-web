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

    vout = 0;
    iout = 0;
    pout = 0;
    tout = 0;
    outMode = 'CV';
    stateRelay = false;
    stateOutput = false;
    stateLock = false;

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
            await this.port.open({ baudRate: 115200 });

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
                                    await this.writeLine(`vset,${e.target.value}`);
                                });


                                this.isetSlider = this.querySelector('.iset-slider');
                                this.isetValue = this.querySelector('.iset-value');

                                this.isetSlider.addEventListener('input', async e => {
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

                                this.getInitialState();

                                const statusInterval = setInterval(async () =>
                                {
                                    if (!this.port.writable)
                                    {
                                        clearInterval(statusInterval);
                                        return;
                                    }

                                    await this.writeLine('status');
                                }, 100);
                            }
                            else if (!this.classList.contains('discovering'))
                            {
                                if (linePart.indexOf('vset,') === 0)
                                {
                                    const vsetParts = linePart.split(',');

                                    this.vsetSlider.value = vsetParts[1];

                                    const newValue = Number( (this.vsetSlider.value) * 100 / this.vsetSlider.max );
                                    const newPosition = 3 - (newValue * 0.31);
                                    this.vsetValue.innerHTML = `<span>${Number(this.vsetSlider.value).toFixed(2)} V</span>`;
                                    this.vsetValue.style.bottom = `calc(${newValue}% + (${newPosition}px))`;
                                }
                                else if (linePart.indexOf('iset,') === 0)
                                {
                                    const isetParts = linePart.split(',');

                                    this.isetSlider.value = isetParts[1];

                                    const newValue = Number( (this.isetSlider.value - this.isetSlider.min) * 100 / (this.isetSlider.max - this.isetSlider.min) );
                                    const newPosition = 3 - (newValue * 0.31);
                                    this.isetValue.innerHTML = `<span>${Number(this.isetSlider.value).toFixed(3)} A</span>`;
                                    this.isetValue.style.bottom = `calc(${newValue}% + (${newPosition}px)`;
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

    updatePowerLabel()
    {
        this.querySelector('.pout-value').innerText = (this.vout * this.iout).toFixed(2);
    }
}

customElements.define('serial-devices', SerialDevices);
customElements.define('serial-device', SerialDevice);
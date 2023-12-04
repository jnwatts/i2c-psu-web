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

        await this.port.open({ baudRate: 115200 });

        this.readSerial();

        this.writeLine('id');

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
    }

    async writeLine(line)
    {
        const writer = this.port.writable.getWriter();

        const encoder = new TextEncoder();

        await writer.write(encoder.encode(`${line}\n`));

        writer.releaseLock();
    }

    async readSerial()
    {
        let line = '';

        while(this.port.readable)
        {
            const reader = this.port.readable.getReader();

            try
            {
                while (true)
                {
                    const { value, done } = await reader.read();

                    if (done)
                        break;

                    const decoder = new TextDecoder();

                    line += decoder.decode(value);

                    if (line.indexOf('\n') !== -1)
                    {
                        const lineParts = line.split('\n');

                        line = lineParts.pop();

                        lineParts.forEach(linePart =>
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
                reader.releaseLock();
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
}

customElements.define('serial-devices', SerialDevices);
customElements.define('serial-device', SerialDevice);
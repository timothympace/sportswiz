import React from 'react';

class WizTable extends React.Component {
    constructor() {
        super();
        this.state = {
            data : []
        };
    }

    componentDidMount() {
        fetch('api/channels').then(res => res.json()).then(data => {
            this.setState({ data });
        });
    }

    render() {
        let rows = this.state.data.map(ch => {
            return <ChannelRow data = { ch } />
        });
        return (
            <table>
                <thead>
                    <th>Channel</th>
                    <th>Time</th>
                    <th>Sport</th>
                    <th>Title</th>
                    <th>VLC iOS</th>
                    <th>HLS</th>
                </thead>
                < tbody > {
                    rows
                } </tbody>
            </table>
        );
    }
}

const ChannelRow = (props) => {
    let time = new Date(props.data.time);
    time = time.toLocaleString('en-US', {
        hour: 'numeric',
        minute: 'numeric'
    });
    return (
        <tr>
            <td>{ props.data.channel }</td>
            <td>{ time }</td>
            <td>{ props.data.sport }</td>
            <td>{ props.data.title }</td>
            <td><a href = { "vlc-x-callback://x-callback-url/stream?url= " + props.data.rtmp }>VLC iOS</a></td>
            <td><a href = { props.data.hls }>HLS</a></td>
        </tr>
    );
};

export default WizTable;